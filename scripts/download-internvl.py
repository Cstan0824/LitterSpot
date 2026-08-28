"""Download and revision-lock the official InternVL3.5-1B checkpoint."""
from __future__ import annotations

import json
from pathlib import Path

from huggingface_hub import snapshot_download


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "OpenGVLab/InternVL3_5-1B-Instruct"
REVISION = "5648fa26ff23acaba53588936d9f1dfaf305f522"
DESTINATION = ROOT / "models" / "huggingface" / "OpenGVLab--InternVL3_5-1B-Instruct"
LOCK_PATH = ROOT / "models" / "internvl3_5_1b.lock.json"


def main() -> None:
    snapshot_download(
        repo_id=REPOSITORY,
        revision=REVISION,
        local_dir=DESTINATION,
        max_workers=1,
    )
    LOCK_PATH.write_text(json.dumps({
        "repository": REPOSITORY,
        "revision": REVISION,
        "path": str(DESTINATION.relative_to(ROOT)).replace("\\", "/"),
    }, indent=2) + "\n", encoding="utf-8")
    print(f"Downloaded {REPOSITORY}@{REVISION} to {DESTINATION}")


if __name__ == "__main__":
    main()
