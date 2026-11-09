"""Optional fused decode quantization; no additional Python dependencies.

NVRTC is provided by CUDA PyTorch. CUDA headers/toolkit must also be present.
Compilation failure leaves the portable PyTorch FP8 implementation available.
"""
from functools import lru_cache
import logging


SOURCE = r'''
#include <cuda_bf16.h>
#include <cuda_fp16.h>
#include <cuda_fp8.h>

__device__ float as_float(__nv_bfloat16 x) { return __bfloat162float(x); }
__device__ float as_float(__half x) { return __half2float(x); }

// A decode input contains at most 16 rows. Reduce the same tensor-wide maximum
// as the portable implementation, then quantize and pad in a single launch.
template<typename T>
__global__ void quantize_decode(const T* x, __nv_fp8_e4m3* y, float* scale,
                                int n, int padded) {
    __shared__ float maxima[256];
    float m = 0.f;
    for (int i = threadIdx.x; i < n; i += blockDim.x)
        m = fmaxf(m, fabsf(as_float(x[i])));
    maxima[threadIdx.x] = m;
    __syncthreads();
    for (int stride = 128; stride; stride >>= 1) {
        if (threadIdx.x < stride)
            maxima[threadIdx.x] = fmaxf(maxima[threadIdx.x], maxima[threadIdx.x + stride]);
        __syncthreads();
    }
    // PyTorch's division by a CPU scalar multiplies by its FP32 reciprocal.
    // Match that rounding exactly; an actual divide can change E4M3 ties.
    float s = __fmul_rn(fmaxf(maxima[0], 1.e-12f), (1.f / 448.f));
    if (threadIdx.x == 0) scale[0] = s;
    for (int i = threadIdx.x; i < padded; i += blockDim.x)
        y[i] = __nv_fp8_e4m3(i < n ? fminf(448.f, fmaxf(-448.f, as_float(x[i]) / s)) : 0.f);
}
'''


@lru_cache(maxsize=8)
def decode_quantizer(device_index, dtype):
    import torch
    if dtype not in (torch.bfloat16, torch.float16):
        return None
    try:
        with torch.cuda.device(device_index):
            name = '__nv_bfloat16' if dtype == torch.bfloat16 else '__half'
            return torch.cuda._compile_kernel(SOURCE, f'quantize_decode<{name}>')
    except Exception as exc:
        logging.getLogger(__name__).warning(
            'Fused FP8 decode unavailable; using CUDA scaled GEMM with PyTorch quantization: %s', exc)
        return None


def quantize_decode(flat, kernel):
    """Returns fresh, stream-ordered outputs; never caches image activations."""
    import torch
    rows, columns = flat.shape
    quant = torch.empty((16, columns), device=flat.device, dtype=torch.float8_e4m3fn)
    scale = torch.empty((1,), device=flat.device, dtype=torch.float32)
    kernel(grid=(1, 1, 1), block=(256, 1, 1),
           args=[flat, quant, scale, rows * columns, quant.numel()])
    return quant, scale
