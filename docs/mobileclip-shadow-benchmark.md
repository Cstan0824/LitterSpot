# Frozen MobileCLIP shadow benchmark

MobileCLIP is not used in the live alert path. This experiment freezes every
MobileCLIP parameter and trains only a three-class linear head (`normal`,
`full`, `overflow`) on crop embeddings. That is not VLM fine-tuning.

First download the official `MobileCLIP-S0` PyTorch checkpoint and install its
reference runtime, as documented by Apple:

```powershell
.\.venv\Scripts\python.exe -m pip install "git+https://github.com/apple/ml-mobileclip.git"
.\.venv\Scripts\python.exe ml-training\scripts\train_mobileclip_linear_probe.py --weights C:\path\to\mobileclip_s0.pt
```

The report contains train, validation, and untouched test accuracy and a
confusion matrix. Do not promote it based on accuracy alone. Compare it with
the MobileNet test report on the same crops, including overflow precision and
recall, per-domain results, and full-versus-overflow errors. Keep MobileNet
alone unless the challenger improves the locked test set.

The production architecture remains `localizer -> padded crop -> MobileNet ->
unknown/confirmation`. A future fusion stage is allowed only after this shadow
benchmark demonstrates complementary errors, not merely a better aggregate
score.
