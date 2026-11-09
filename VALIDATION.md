# Validation

This document records local functional checks and bounded performance experiments. It does not establish annotation accuracy for arbitrary games, compatibility with every GPU, or the quality of a trained detector.

## Tested environment

- Windows and Python 3.11.
- PyTorch 2.10.0+cu126, Transformers 5.12.1 and bitsandbytes 0.49.2.
- NVIDIA GeForce RTX 4070 SUPER, 12 GB VRAM.
- Ultralytics 8.3.228 for the recorded training checks.

The hardware minimums in the README are estimates. GTX 1060, RTX 2060 and other 6 GB/8 GB cards have not been validated locally.

## Automated checks

The last recorded complete suite passed **23 tests**. Coverage includes:

- Project isolation, settings persistence, rename/removal and source-file preservation.
- Annotation saves, revision conflicts and protection of reviewed labels.
- Team/head class layouts and structured output parsing.
- Normalization, padding and original-image coordinate mapping.
- Image formats, EXIF orientation, corrupt inputs and path handling.
- YOLO export, empty negative labels and train/validation separation.
- Video metadata, timed sampling, cancellation, deduplication and resume.
- FP8 CUDA math, fused activation quantization and compiler fallback.

Additional API checks verified the four current pixel budgets (1M, 2M, 4M and 8M), the 2M default, rejection outside the allowed range, and migration of older budgets below 1M.

## Annotation runtime

Both WeVisOne-VL sizes returned structured boxes in Native, FP8 and Q4 functional smoke tests. CUDA math checks compared quantized linear layers with native results. Fused decode checks matched the portable activation quantizer bit for bit for the tested BF16/FP16 inputs.

An FP8 optimization comparison on three 1920 × 1080 game frames reduced warm mean prediction time from 11.816 to 1.534 seconds/image. Both versions used identical weights, prompts and settings, a 589,824-pixel budget and batch 1; model loading was excluded. Allocator reservation after inference fell from 12,988 to 6,164 MiB. Those three responses were empty in both versions. A separate nonempty sample preserved six box coordinates exactly.

These are historical developer measurements: their pixel budgets predate the current 1M minimum. They are not representative throughput guarantees for current 2M defaults, long responses, teams/heads, or 4M/8M images.

A cached model processor accepted generated 4K inputs at 2M, 4M and 8M budgets, with patch-aligned output dimensions within each cap. This was a CPU preprocessing check; full 4M/8M GPU inference has not been benchmarked.

## YOLO training

A real API-triggered job exported a separate test dataset, trained YOLO11n at 640px with batch 8 and CUDA/AMP for five epochs, reported finite losses and distinct progress entries, and saved both `best.pt` and `last.pt`. The checkpoint download succeeded, and the best model reloaded for CUDA prediction with the expected classes.

A stop test completed cooperatively, preserved a downloadable checkpoint and retained unique epoch history. Training tests used separate storage and did not replace production project settings or labels.

Two repeated small-data profiling trials measured warm epoch means of 0.4980 seconds with the current zero-worker/no-cache configuration and 0.3317 seconds with two loader workers. Total eight-epoch train-call time remained about 20 seconds because initialization offset the warm-step improvement. These results do not establish a universal worker-count recommendation, and production defaults were not changed by the experiment.

## UI and workflow checks

Earlier browser checks covered image/video import, annotation editing and autosave, project management, bulk image removal, exports, training progress, English/Traditional Chinese switching and responsive layouts. Later backend/settings changes used API and syntax checks; not every UI check was repeated after every change.

## Reproduce the automated suite

```powershell
.\.venv\Scripts\python.exe -m pip install pytest httpx
.\.venv\Scripts\python.exe -m pytest -q tests
```

CUDA-specific tests may skip without a compatible GPU or runtime compiler. Real model inference and training smoke runs are separate from the automated suite and require downloaded weights.
