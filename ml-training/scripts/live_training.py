"""Refresh a readable terminal view of the controlled training state."""
import argparse, json, os, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(); parser.add_argument("--interval", type=float, default=2); parser.add_argument("--run", default="yoloe26s_fused_tune20_v1"); args = parser.parse_args()
state_path = ROOT / "ml-training/logs" / args.run / "state.json"
while True:
    os.system("cls" if os.name == "nt" else "clear")
    print("LitterSpot controlled training (Ctrl+C closes viewer only)\n")
    if not state_path.exists(): print("Waiting for the first completed epoch...")
    else:
        s=json.loads(state_path.read_text()); x=s["latest"]; o=x["overall"]; v=x["overflow"]; r=x["resources"]
        print(f"Status: {s['status']}  Epoch: {s['epoch']}/{s['epochs']}  Epoch time: {x['epoch_seconds']:.1f}s")
        print(f"Overall: P={o.get('metrics/precision(B)',0):.4f} R={o.get('metrics/recall(B)',0):.4f} mAP50={o.get('metrics/mAP50(B)',0):.4f} mAP50-95={o.get('metrics/mAP50-95(B)',0):.4f}")
        print(f"Overflow: P={v['precision']:.4f} R={v['recall']:.4f} mAP50={v['map50']:.4f} mAP50-95={v['map50_95']:.4f}")
        print(f"Score={x['selection_score']:.4f} best={s['best_score']:.4f} at epoch {s['best_epoch']}")
        print(f"CPU={r['cpu_percent']:.1f}% RAM={r['ram_percent']:.1f}% GPU={r['gpu_utilization_percent']}% VRAM={r['gpu_memory_used_mb']}MB GPU temp={r['gpu_temperature_c']}C disk={r['disk_free_gb']:.1f}GB")
        print(f"Stop reason: {s['stop_reason'] or 'none'}")
    time.sleep(args.interval)
