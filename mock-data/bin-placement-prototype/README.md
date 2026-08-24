# Short-window bin placement mocks

These deterministic timelines exercise the prototype replacement rule without
requiring a model inference run. Each file contains one observation per minute
for a ten-minute window (or fewer rows for the coverage-failure case).

Run the benchmark from the repository root:

```powershell
python scripts/evaluate_bin_replacement_mocks.py
```

The rule is intentionally conservative: at least 8 valid minutes, no more than
20% unknown bin states, a score of 70 or higher, and at least two independent
high signals. A passing window must pass twice before raising a recommendation.
