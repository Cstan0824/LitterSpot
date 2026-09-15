# Dataset Inspection Report

## Search Roots

- /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset
- /Users/chinchunggan/Downloads

## Assumptions

- Raw dataset folders are treated as read-only.
- Generated outputs are written only inside the project workspace.
- TACO COCO polygon segmentations map to class 0 `floor_litter`.
- HD10K liquid/stain masks map to class 1 `floor_spill`; HD10K solid bounding boxes are skipped.

## TACO

Detected COCO JSON files: 8
### /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/annotations.json

- Annotation format: COCO instance segmentation JSON
- Images: 715
- Annotations: 2152
- Categories (60): Aluminium foil, Battery, Aluminium blister pack, Carded blister pack, Other plastic bottle, Plastic drink bottle, Glass bottle, Plastic bottle cap, Metal bottle cap, Broken glass, Food Can, Aerosol, Drink can, Toilet tube, Other carton, Egg carton, Drink carton, Corrugated carton, Meal carton, Pizza box, Paper cup, Disposable plastic cup, Foam cup, Glass cup, Other plastic cup, Food waste, Glass jar, Plastic lid, Metal lid, Other plastic, Magazine paper, Tissues, Wrapping paper, Normal paper, Paper bag, Plastified paper bag, Plastic Film, Six pack rings, Garbage bag, Other plastic wrapper, Single-use carrier bag, Polypropylene bag, Crisp packet, Spread tub, Tupperware, Disposable food container, Foam food container, Other plastic container, Plastic glooves, Plastic utensils, Pop tab, Rope & strings, Scrap metal, Shoe, Squeezable tube, Plastic straw, Paper straw, Styrofoam piece, Unlabeled litter, Cigarette
- Polygon segmentation annotations: 2152
- Missing/unmatched image references: 0
- Image directories:
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_7: 127
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_5: 112
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_1: 101
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_3: 97
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_6: 97
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_2: 92
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_4: 89

### /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_1/annotations.json

- Annotation format: COCO instance segmentation JSON
- Images: 101
- Annotations: 309
- Categories (60): Aluminium foil, Battery, Aluminium blister pack, Carded blister pack, Other plastic bottle, Plastic drink bottle, Glass bottle, Plastic bottle cap, Metal bottle cap, Broken glass, Food Can, Aerosol, Drink can, Toilet tube, Other carton, Egg carton, Drink carton, Corrugated carton, Meal carton, Pizza box, Paper cup, Disposable plastic cup, Foam cup, Glass cup, Other plastic cup, Food waste, Glass jar, Plastic lid, Metal lid, Other plastic, Magazine paper, Tissues, Wrapping paper, Normal paper, Paper bag, Plastified paper bag, Plastic Film, Six pack rings, Garbage bag, Other plastic wrapper, Single-use carrier bag, Polypropylene bag, Crisp packet, Spread tub, Tupperware, Disposable food container, Foam food container, Other plastic container, Plastic glooves, Plastic utensils, Pop tab, Rope & strings, Scrap metal, Shoe, Squeezable tube, Plastic straw, Paper straw, Styrofoam piece, Unlabeled litter, Cigarette
- Polygon segmentation annotations: 309
- Missing/unmatched image references: 0
- Image directories:
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_1: 101

### /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_2/annotations.json

- Annotation format: COCO instance segmentation JSON
- Images: 92
- Annotations: 288
- Categories (60): Aluminium foil, Battery, Aluminium blister pack, Carded blister pack, Other plastic bottle, Plastic drink bottle, Glass bottle, Plastic bottle cap, Metal bottle cap, Broken glass, Food Can, Aerosol, Drink can, Toilet tube, Other carton, Egg carton, Drink carton, Corrugated carton, Meal carton, Pizza box, Paper cup, Disposable plastic cup, Foam cup, Glass cup, Other plastic cup, Food waste, Glass jar, Plastic lid, Metal lid, Other plastic, Magazine paper, Tissues, Wrapping paper, Normal paper, Paper bag, Plastified paper bag, Plastic Film, Six pack rings, Garbage bag, Other plastic wrapper, Single-use carrier bag, Polypropylene bag, Crisp packet, Spread tub, Tupperware, Disposable food container, Foam food container, Other plastic container, Plastic glooves, Plastic utensils, Pop tab, Rope & strings, Scrap metal, Shoe, Squeezable tube, Plastic straw, Paper straw, Styrofoam piece, Unlabeled litter, Cigarette
- Polygon segmentation annotations: 288
- Missing/unmatched image references: 0
- Image directories:
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_2: 92

### /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_3/annotations.json

- Annotation format: COCO instance segmentation JSON
- Images: 97
- Annotations: 276
- Categories (60): Aluminium foil, Battery, Aluminium blister pack, Carded blister pack, Other plastic bottle, Plastic drink bottle, Glass bottle, Plastic bottle cap, Metal bottle cap, Broken glass, Food Can, Aerosol, Drink can, Toilet tube, Other carton, Egg carton, Drink carton, Corrugated carton, Meal carton, Pizza box, Paper cup, Disposable plastic cup, Foam cup, Glass cup, Other plastic cup, Food waste, Glass jar, Plastic lid, Metal lid, Other plastic, Magazine paper, Tissues, Wrapping paper, Normal paper, Paper bag, Plastified paper bag, Plastic Film, Six pack rings, Garbage bag, Other plastic wrapper, Single-use carrier bag, Polypropylene bag, Crisp packet, Spread tub, Tupperware, Disposable food container, Foam food container, Other plastic container, Plastic glooves, Plastic utensils, Pop tab, Rope & strings, Scrap metal, Shoe, Squeezable tube, Plastic straw, Paper straw, Styrofoam piece, Unlabeled litter, Cigarette
- Polygon segmentation annotations: 276
- Missing/unmatched image references: 0
- Image directories:
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_3: 97

### /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_4/annotations.json

- Annotation format: COCO instance segmentation JSON
- Images: 89
- Annotations: 164
- Categories (60): Aluminium foil, Battery, Aluminium blister pack, Carded blister pack, Other plastic bottle, Plastic drink bottle, Glass bottle, Plastic bottle cap, Metal bottle cap, Broken glass, Food Can, Aerosol, Drink can, Toilet tube, Other carton, Egg carton, Drink carton, Corrugated carton, Meal carton, Pizza box, Paper cup, Disposable plastic cup, Foam cup, Glass cup, Other plastic cup, Food waste, Glass jar, Plastic lid, Metal lid, Other plastic, Magazine paper, Tissues, Wrapping paper, Normal paper, Paper bag, Plastified paper bag, Plastic Film, Six pack rings, Garbage bag, Other plastic wrapper, Single-use carrier bag, Polypropylene bag, Crisp packet, Spread tub, Tupperware, Disposable food container, Foam food container, Other plastic container, Plastic glooves, Plastic utensils, Pop tab, Rope & strings, Scrap metal, Shoe, Squeezable tube, Plastic straw, Paper straw, Styrofoam piece, Unlabeled litter, Cigarette
- Polygon segmentation annotations: 164
- Missing/unmatched image references: 0
- Image directories:
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_4: 89

### /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_5/annotations.json

- Annotation format: COCO instance segmentation JSON
- Images: 112
- Annotations: 303
- Categories (60): Aluminium foil, Battery, Aluminium blister pack, Carded blister pack, Other plastic bottle, Plastic drink bottle, Glass bottle, Plastic bottle cap, Metal bottle cap, Broken glass, Food Can, Aerosol, Drink can, Toilet tube, Other carton, Egg carton, Drink carton, Corrugated carton, Meal carton, Pizza box, Paper cup, Disposable plastic cup, Foam cup, Glass cup, Other plastic cup, Food waste, Glass jar, Plastic lid, Metal lid, Other plastic, Magazine paper, Tissues, Wrapping paper, Normal paper, Paper bag, Plastified paper bag, Plastic Film, Six pack rings, Garbage bag, Other plastic wrapper, Single-use carrier bag, Polypropylene bag, Crisp packet, Spread tub, Tupperware, Disposable food container, Foam food container, Other plastic container, Plastic glooves, Plastic utensils, Pop tab, Rope & strings, Scrap metal, Shoe, Squeezable tube, Plastic straw, Paper straw, Styrofoam piece, Unlabeled litter, Cigarette
- Polygon segmentation annotations: 303
- Missing/unmatched image references: 0
- Image directories:
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_5: 112

### /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_6/annotations.json

- Annotation format: COCO instance segmentation JSON
- Images: 97
- Annotations: 407
- Categories (60): Aluminium foil, Battery, Aluminium blister pack, Carded blister pack, Other plastic bottle, Plastic drink bottle, Glass bottle, Plastic bottle cap, Metal bottle cap, Broken glass, Food Can, Aerosol, Drink can, Toilet tube, Other carton, Egg carton, Drink carton, Corrugated carton, Meal carton, Pizza box, Paper cup, Disposable plastic cup, Foam cup, Glass cup, Other plastic cup, Food waste, Glass jar, Plastic lid, Metal lid, Other plastic, Magazine paper, Tissues, Wrapping paper, Normal paper, Paper bag, Plastified paper bag, Plastic Film, Six pack rings, Garbage bag, Other plastic wrapper, Single-use carrier bag, Polypropylene bag, Crisp packet, Spread tub, Tupperware, Disposable food container, Foam food container, Other plastic container, Plastic glooves, Plastic utensils, Pop tab, Rope & strings, Scrap metal, Shoe, Squeezable tube, Plastic straw, Paper straw, Styrofoam piece, Unlabeled litter, Cigarette
- Polygon segmentation annotations: 407
- Missing/unmatched image references: 0
- Image directories:
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_6: 97

### /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_7/annotations.json

- Annotation format: COCO instance segmentation JSON
- Images: 127
- Annotations: 405
- Categories (60): Aluminium foil, Battery, Aluminium blister pack, Carded blister pack, Other plastic bottle, Plastic drink bottle, Glass bottle, Plastic bottle cap, Metal bottle cap, Broken glass, Food Can, Aerosol, Drink can, Toilet tube, Other carton, Egg carton, Drink carton, Corrugated carton, Meal carton, Pizza box, Paper cup, Disposable plastic cup, Foam cup, Glass cup, Other plastic cup, Food waste, Glass jar, Plastic lid, Metal lid, Other plastic, Magazine paper, Tissues, Wrapping paper, Normal paper, Paper bag, Plastified paper bag, Plastic Film, Six pack rings, Garbage bag, Other plastic wrapper, Single-use carrier bag, Polypropylene bag, Crisp packet, Spread tub, Tupperware, Disposable food container, Foam food container, Other plastic container, Plastic glooves, Plastic utensils, Pop tab, Rope & strings, Scrap metal, Shoe, Squeezable tube, Plastic straw, Paper straw, Styrofoam piece, Unlabeled litter, Cigarette
- Polygon segmentation annotations: 405
- Missing/unmatched image references: 0
- Image directories:
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/TACO/data/batch_7: 127

## HD10K / IROS2022 Active Cleaning

### /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/IROS2022_Dataset

- Annotation format: liquid/stain masks; solid-rubbish bounding boxes are present but skipped.
- Training liquid image/mask pairs: 4000
- Official test liquid image/mask pairs: 2000
- Training scenes: scene_0, scene_1
- Official test scenes: scene_1, scene_2
- Image and mask stem matches: 6000/6000
- Mask foreground assumption: any non-zero grayscale value or non-black color pixel is treated as spill foreground.
- Sample mask values:
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/IROS2022_Dataset/train/liquid_dirts/liquid_dirts_masks/scene_0/2021-9-15-2-21-45_0-1631643705994293423_keyframe.png: []
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/IROS2022_Dataset/train/liquid_dirts/liquid_dirts_masks/scene_0/2021-9-15-2-21-45_0-1631643706091809276.png: []
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/IROS2022_Dataset/train/liquid_dirts/liquid_dirts_masks/scene_0/2021-9-15-2-21-45_0-1631643706190842209.png: []
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/IROS2022_Dataset/train/liquid_dirts/liquid_dirts_masks/scene_0/2021-9-15-2-21-45_0-1631643706290608572.png: []
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/IROS2022_Dataset/train/liquid_dirts/liquid_dirts_masks/scene_0/2021-9-15-2-21-45_0-1631643706391200708.png: []
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/IROS2022_Dataset/train/liquid_dirts/liquid_dirts_masks/scene_0/2021-9-15-2-21-45_0-1631643706491311022.png: []
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/IROS2022_Dataset/train/liquid_dirts/liquid_dirts_masks/scene_0/2021-9-15-2-21-45_0-1631643706591207629.png: []
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/IROS2022_Dataset/train/liquid_dirts/liquid_dirts_masks/scene_0/2021-9-15-2-21-45_0-1631643706691199055.png: []
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/IROS2022_Dataset/train/liquid_dirts/liquid_dirts_masks/scene_0/2021-9-15-2-21-45_0-1631643706790830027.png: []
  - /Users/chinchunggan/Coding/LitterSpot/dataset/floor_rubbish/raw_dataset/IROS2022_Dataset/train/liquid_dirts/liquid_dirts_masks/scene_0/2021-9-15-2-21-45_0-1631643706890931176.png: []
- Missing/unmatched files: 0
