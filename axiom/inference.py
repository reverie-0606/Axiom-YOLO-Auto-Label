"""Detection-only WeVisOne runtime; no unused pixel decoder or segmentation dependencies.

Prompt format and coordinate tokens follow Tencent/WeVisOne-VL (Apache-2.0).
"""
from __future__ import annotations

import gc
import re

from .imaging import fit_image, map_box, open_image

BOX_RE = re.compile(r"<box>(.*?)(?:</box>|$)", re.I | re.S)
COORD_RE = re.compile(r"<(\d{1,4})>")


def parse_boxes(text, class_id):
    clean = text.split("<|im_end|>")[0].split("<|endoftext|>")[0].strip()
    if not clean or clean.lower().strip(". ") == "none":
        return []
    boxes = []
    bodies = BOX_RE.findall(clean)
    if not bodies:
        raise ValueError("Model response did not contain structured boxes or None. Try a shorter, concrete description.")
    for body in bodies:
        if body.strip().lower().strip('. ') == 'none':
            continue
        nums = [int(v) for v in COORD_RE.findall(body)]
        if not nums or len(nums) % 4:
            raise ValueError("Incomplete model box coordinates. Increase the output token limit.")
        for i in range(0, len(nums), 4):
            x1, y1, x2, y2 = nums[i:i + 4]
            if not all(0 <= v <= 1000 for v in (x1, y1, x2, y2)):
                raise ValueError("Model returned out-of-range coordinates.")
            if x2 > x1 and y2 > y1:
                box = dict(class_id=class_id, x1=x1 / 1000, y1=y1 / 1000, x2=x2 / 1000, y2=y2 / 1000)
                if box not in boxes:
                    boxes.append(box)
    return boxes


def prompts(settings):
    if settings["teams"]:
        queries = [settings["teammate"], settings["enemy"]] if settings["describe"] else ["friendly player characters", "enemy player characters"]
    else:
        queries = [settings["target"] if settings["describe"] else "player characters"]
    if any(not q.strip() for q in queries):
        raise ValueError("Describe both teammates and enemies." if settings["teams"] else "Describe the target.")
    context = f" in the video game {settings['game']}" if settings["game"] else " in this game screenshot"
    full = [f"full bodies of {q}{context}" for q in queries]
    if settings["heads"]:
        full += [f"heads only of {q}{context}" for q in queries]
    return ["Locate all the instances that match the following description: " + q.rstrip(".") + "." for q in full]


def make_fp8_linear(linear, fast):
    """Real E4M3 weights; scaled CUDA GEMM on Ada+, dequantized GEMM elsewhere."""
    import torch
    from torch import nn
    from torch.nn import functional as F

    class FP8Linear(nn.Module):
        def __init__(self, source):
            super().__init__()
            self.in_features, self.out_features = source.in_features, source.out_features
            self.input_dtype = source.weight.dtype
            scale = source.weight.detach().float().abs().amax().clamp_min(1e-12) / 448.0
            self.register_buffer("scale", scale.reshape(1))
            self.register_buffer("weight", (source.weight.detach().float() / scale).clamp(-448, 448).to(torch.float8_e4m3fn))
            self.register_buffer("bias", source.bias.detach().clone() if source.bias is not None else None)
            self.fast = fast and self.in_features % 16 == 0 and self.out_features % 16 == 0
            self.decode_kernel = None
            if self.fast and source.weight.is_cuda:
                from .fp8 import decode_quantizer
                self.decode_kernel = decode_quantizer(source.weight.device.index, source.weight.dtype)

        def forward(self, x):
            if not self.fast:
                return F.linear(x, self.weight.to(x.dtype) * self.scale.to(x.dtype), self.bias)
            shape = x.shape
            flat = x.reshape(-1, shape[-1])
            rows = flat.shape[0]
            if self.decode_kernel is not None and 0 < rows <= 16 and flat.is_contiguous() and x.dtype == self.input_dtype:
                from .fp8 import quantize_decode
                quant, scale_x = quantize_decode(flat, self.decode_kernel)
            else:
                scale_x = flat.detach().float().abs().amax().clamp_min(1e-12).reshape(1) / 448.0
                quant = (flat.float() / scale_x).clamp(-448, 448).to(torch.float8_e4m3fn)
                pad = (-rows) % 16
                if pad:
                    quant = torch.cat([quant, torch.zeros((pad, quant.shape[1]), dtype=quant.dtype, device=quant.device)])
            out = torch._scaled_mm(quant, self.weight.t(), scale_a=scale_x, scale_b=self.scale,
                                   bias=self.bias, out_dtype=x.dtype, use_fast_accum=True)
            return out[:rows].reshape(*shape[:-1], self.out_features)

    return FP8Linear(linear)


def quantize_fp8(model, fast, device=None):
    import torch
    count = 0
    # Quantize the language decoder only, preserving vision encoder and output head.
    # Keep names only: retaining the modules keeps ALL original BF16 weights alive
    # until the conversion finishes, needlessly exceeding a 12 GB GPU's budget.
    names = [name for name, module in model.named_modules()
             if isinstance(module, torch.nn.Linear) and ".language_model." in name and ".layers." in name]
    for name in names:
        parent, _, child = name.rpartition(".")
        source = model.get_submodule(name)
        if device is not None:
            source = source.to(device)
        setattr(model.get_submodule(parent), child, make_fp8_linear(source, fast))
        del source
        count += 1
    if not count:
        raise RuntimeError("No supported language decoder layers found for FP8 quantization.")
    return count


class Engine:
    def __init__(self):
        self.model = None
        self.processor = None
        self.key = None
        self.info = {"loaded": False, "name": "No model loaded", "mode": "", "memory_mb": 0, "reserved_mb": 0}

    def unload(self):
        self.model = self.processor = self.key = None
        gc.collect()
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        self.info = {"loaded": False, "name": "No model loaded", "mode": "", "memory_mb": 0, "reserved_mb": 0}

    def load(self, settings, update, stop):
        import torch
        from transformers import AutoModelForImageTextToText, AutoProcessor, BitsAndBytesConfig
        key = (settings["model"], settings["quantization"], settings["max_pixels"])
        if self.key == key:
            return
        self.unload()
        cuda = torch.cuda.is_available()
        if settings["quantization"] == "q4" and not cuda:
            raise RuntimeError("Q4 requires a CUDA GPU. Select Native for CPU inference.")
        dtype = torch.bfloat16 if cuda and torch.cuda.is_bf16_supported() else (torch.float16 if cuda else torch.float32)
        model_id = f"tencent/WeVisOne-VL-{settings['model']}"
        update(stage="loading", message=f"Downloading / loading {model_id} · {settings['quantization'].upper()}. First load downloads model weights.")
        from huggingface_hub import snapshot_download
        from tqdm.auto import tqdm

        class DownloadProgress(tqdm):
            def update(self, n=1):
                value = super().update(n)
                if self.total and "Fetching" in str(self.desc):
                    update(message=f"Downloading model files · {self.n}/{self.total}")
                return value

        local = snapshot_download(model_id, allow_patterns=["*.json", "*.safetensors", "*.txt", "*.jinja", "*.model"],
                                  tqdm_class=DownloadProgress)
        if stop.is_set():
            return
        update(message="Loading weights into memory…")
        self.processor = AutoProcessor.from_pretrained(local, min_pixels=16 * 32 * 32, max_pixels=settings["max_pixels"])
        self.processor.tokenizer.padding_side = "left"
        if self.processor.tokenizer.pad_token_id is None:
            self.processor.tokenizer.pad_token = self.processor.tokenizer.eos_token
        # Stage FP8 weights on the host and convert one layer at a time. Loading
        # the full native model on CUDA first fragments the allocator and can
        # leave gigabytes reserved even after empty_cache().
        fp8_cuda = cuda and settings["quantization"] == "fp8"
        kwargs = dict(dtype=dtype, attn_implementation="sdpa", low_cpu_mem_usage=True,
                      device_map={"": "cuda:0" if cuda and not fp8_cuda else "cpu"})
        mode = "Native · " + str(dtype).replace("torch.", "")
        if settings["quantization"] == "q4":
            kwargs["quantization_config"] = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=dtype,
                llm_int8_skip_modules=["lm_head", "visual"])
            mode = "Q4 · NF4 double quantization"
        self.model = AutoModelForImageTextToText.from_pretrained(local, **kwargs).eval()
        if settings["quantization"] == "fp8":
            fast = cuda and torch.cuda.get_device_capability() >= (8, 9)
            update(message="Quantizing decoder weights to FP8 E4M3…")
            layers = quantize_fp8(self.model, fast, device="cuda:0" if cuda else None)
            if cuda:
                self.model.to("cuda:0")
                self.model.hf_device_map = {"": "cuda:0"}
            fused = any(getattr(m, 'decode_kernel', None) is not None for m in self.model.modules())
            backend = 'CUDA fused decode' if fused else ('CUDA scaled GEMM' if fast else 'weight-only')
            mode = f"FP8 · {backend} · {layers} layers"
            # Release conversion temporaries once, not after each image/token.
            # On Windows reserved but unused blocks can otherwise trigger WDDM
            # shared-memory pressure during generation.
            gc.collect()
            if cuda:
                torch.cuda.empty_cache()
        self.key = key
        self.info = {"loaded": True, "name": f"WeVisOne-VL {settings['model']}", "mode": mode,
                     "memory_mb": round(torch.cuda.memory_allocated() / 1024 ** 2) if cuda else 0,
                     "reserved_mb": round(torch.cuda.memory_reserved() / 1024 ** 2) if cuda else 0}

    def predict(self, items, settings, stop):
        import torch
        originals = [open_image(item["path"]) for item in items]
        prepared = [fit_image(image, settings["resize"]) for image in originals]
        images = [p[0] for p in prepared]
        results = [[] for _ in items]
        for class_id, prompt in enumerate(prompts(settings)):
            if stop.is_set():
                return None
            messages = [[{"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": [{"type": "image"}, {"type": "text", "text": prompt}]}] for _ in images]
            text = [self.processor.apply_chat_template(m, tokenize=False, add_generation_prompt=True) for m in messages]
            inputs = self.processor(text=text, images=images, padding=True, return_tensors="pt").to(self.model.device)
            with torch.inference_mode():
                out = self.model.generate(**inputs, max_new_tokens=settings["max_tokens"], do_sample=False,
                                          repetition_penalty=1.05, use_cache=True)
            generated = out[:, inputs["input_ids"].shape[1]:]
            raw = self.processor.batch_decode(generated, skip_special_tokens=False, clean_up_tokenization_spaces=False)
            for i, response in enumerate(raw):
                if generated.shape[1] >= settings["max_tokens"] and not any(t in response for t in ("<|im_end|>", "<|endoftext|>")):
                    raise ValueError("Output token limit reached. Increase Max output tokens and retry this image.")
                for box in parse_boxes(response, class_id):
                    mapped = map_box(box, originals[i].size, images[i].size, prepared[i][1], inverse=True)
                    if mapped:
                        results[i].append(mapped)
            del inputs, out, generated
        if self.model.device.type == 'cuda':
            self.info.update(memory_mb=round(torch.cuda.memory_allocated(self.model.device) / 1024 ** 2),
                             reserved_mb=round(torch.cuda.memory_reserved(self.model.device) / 1024 ** 2))
        return results
