# Dataset Build Report

Total prepared images: 3488

## Images by Split

- train: 2438
- val: 496
- test: 554

## Images by Source

- hd10k: 2001
- taco: 715
- uavvaste: 772

## Notes

- TACO was split deterministically at image level.
- HD10K was split by scene plus filename sequence group, not by individual frame.
- Official HD10K test scenes remain under `prepared_dataset/external_test/hd10k` and are not included in train/val/test.
