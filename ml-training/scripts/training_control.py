"""Resource guard, custom checkpoint selector, and structured training logger."""
from __future__ import annotations
import json, math, shutil, signal, subprocess, threading, time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import psutil

def now(): return datetime.now(timezone.utc).isoformat()
def number(value, default=0.0):
    try:
        value=float(value); return value if math.isfinite(value) else default
    except (TypeError, ValueError): return default
def f2(p, r): return 0.0 if 4*p+r <= 0 else 5*p*r/(4*p+r)

@dataclass
class Resources:
    timestamp: str; cpu_percent: float; cpu_temperature_c: float|None; ram_percent: float; ram_used_gb: float
    disk_free_gb: float; gpu_utilization_percent: float|None; gpu_memory_used_mb: float|None
    gpu_memory_total_mb: float|None; gpu_temperature_c: float|None; gpu_power_w: float|None
    training_rss_gb: float|None=None; top_memory_processes: list[dict[str,Any]]=field(default_factory=list)

class TrainingControl:
    def __init__(self, root: Path, config: dict[str,Any]):
        self.root=root; self.config=config; self.run_name=config["run"]["name"]
        self.log_dir=root/"ml-training/logs"/self.run_name; self.log_dir.mkdir(parents=True,exist_ok=True)
        self.control_dir=root/"ml-training/control"; self.control_dir.mkdir(parents=True,exist_ok=True)
        self.stop_file=self.control_dir/f"STOP_{self.run_name}"; self.stop_event=threading.Event(); self.stop_reason=None; self.trainer=None
        self.started=self.last_activity=self.epoch_started=time.monotonic(); self.breaches={}; self.best_score=-1.0; self.best_epoch=-1; self.last_better=-1; self.best_accepted_score=-1.0
        self.train_batch=0; self.train_batches=0; self.val_batch=0; self.val_batches=0; self.last_live_write=0.0
        state_path=self.log_dir/"selection.json"
        if state_path.exists():
            try:
                state=json.loads(state_path.read_text(encoding="utf-8")); self.best_score=number(state.get("best_score"),-1.0)
                self.best_epoch=int(state.get("best_epoch",-1)); self.last_better=self.best_epoch; self.best_accepted_score=number(state.get("best_accepted_score"),-1.0)
            except (OSError,ValueError,TypeError,json.JSONDecodeError): pass

    def append(self, file, record):
        with (self.log_dir/file).open("a",encoding="utf-8") as f: f.write(json.dumps(record)+"\n")
    def event(self,event,**details): self.append("events.jsonl",{"timestamp":now(),"event":event,**details})
    def stop(self,reason):
        if self.stop_reason is None: self.stop_reason=reason; self.event("stop_requested",reason=reason)
        self.stop_event.set()
        if self.trainer is not None: self.trainer.stop=True
    def start(self):
        self.stop_file.unlink(missing_ok=True)
        (self.log_dir/"summary.json").unlink(missing_ok=True)
        signal.signal(signal.SIGINT,lambda s,f:self.stop(f"signal {s}")); signal.signal(signal.SIGTERM,lambda s,f:self.stop(f"signal {s}"))
        self.event("controller_started",config=self.config)
        threading.Thread(target=self.monitor,daemon=True,name="resource-monitor").start()
    def bind(self,trainer): self.trainer=trainer; self.event("trainer_bound",save_dir=str(trainer.save_dir))
    def write_live(self, phase, force=False):
        current=time.monotonic()
        if not force and current-self.last_live_write<1.0: return
        self.last_live_write=current
        epoch=(int(self.trainer.epoch)+1) if self.trainer is not None else 0
        total=int(getattr(self.trainer,"epochs",self.config["run"]["epochs"])) if self.trainer is not None else int(self.config["run"]["epochs"])
        payload={"timestamp":now(),"status":"stopping" if self.stop_event.is_set() else "training","phase":phase,"epoch":epoch,"epochs":total,"train_batch":self.train_batch,"train_batches":self.train_batches,"val_batch":self.val_batch,"val_batches":self.val_batches,"stop_reason":self.stop_reason}
        (self.log_dir/"live.json").write_text(json.dumps(payload,indent=2),encoding="utf-8")
    def heartbeat(self,trainer):
        self.trainer=trainer; self.last_activity=time.monotonic()
        if self.stop_event.is_set(): trainer.stop=True
    def train_heartbeat(self,trainer):
        self.heartbeat(trainer); self.train_batch+=1; self.write_live("training")
    def validation_start(self,validator):
        self.val_batch=0
        loader=getattr(validator,"dataloader",None)
        self.val_batches=len(loader) if loader is not None else 0
        self.write_live("validation",True)
    def validation_heartbeat(self,validator):
        self.last_activity=time.monotonic(); self.val_batch+=1
        if self.stop_event.is_set() and self.trainer is not None: self.trainer.stop=True
        self.write_live("validation")
    def epoch_start(self,trainer):
        self.trainer=trainer; self.epoch_started=time.monotonic(); self.last_activity=self.epoch_started
        self.train_batch=0; self.train_batches=len(trainer.train_loader); self.val_batch=0; self.val_batches=0
        self.write_live("training",True)

    def cpu_temp(self):
        fn=getattr(psutil,"sensors_temperatures",None)
        if not fn: return None
        try:
            values=[x.current for group in fn().values() for x in group if x.current is not None]
            return max(values) if values else None
        except (OSError,RuntimeError): return None
    def gpu(self):
        cmd=["nvidia-smi","--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw","--format=csv,noheader,nounits"]
        try:
            row=subprocess.run(cmd,capture_output=True,text=True,timeout=5,check=True).stdout.splitlines()[0]
            return tuple(number(x.strip(),float("nan")) for x in row.split(","))
        except (OSError,subprocess.SubprocessError,IndexError): return (None,)*5
    def snapshot(self):
        mem=psutil.virtual_memory(); disk=psutil.disk_usage(str(self.root)); gpu=self.gpu()
        gpu=tuple(None if x is None or not math.isfinite(x) else x for x in gpu)
        rss=0; top=[]
        try:
            parent=psutil.Process(); processes=[parent,*parent.children(recursive=True)]
            rss=sum(p.memory_info().rss for p in processes if p.is_running())/2**30
        except (psutil.Error,OSError): rss=None
        if mem.percent>=80:
            for process in psutil.process_iter(["pid","name","memory_info"]):
                try: top.append({"pid":process.info["pid"],"name":process.info["name"],"rss_gb":process.info["memory_info"].rss/2**30})
                except (psutil.Error,AttributeError): pass
            top=sorted(top,key=lambda x:x["rss_gb"],reverse=True)[:5]
        return Resources(now(),psutil.cpu_percent(),self.cpu_temp(),mem.percent,mem.used/2**30,disk.free/2**30,*gpu,rss,top)
    def sustained(self,key,condition,seconds):
        t=time.monotonic()
        if not condition: self.breaches.pop(key,None); return False
        return t-self.breaches.setdefault(key,t)>=seconds
    def unsafe(self,r):
        c=self.config["resources"]
        if r.disk_free_gb<c["minimum_disk_free_gb"]: return f"disk free {r.disk_free_gb:.1f} GB"
        if self.sustained("ram",r.ram_percent>=c["system_ram_percent"],c["system_ram_sustained_seconds"]): return f"RAM {r.ram_percent:.1f}% sustained"
        if self.sustained("cpu",r.cpu_percent>=c["system_cpu_percent"],c["system_cpu_sustained_seconds"]): return f"CPU {r.cpu_percent:.1f}% sustained"
        if r.gpu_temperature_c is not None and self.sustained("gpu_temp",r.gpu_temperature_c>=c["gpu_temperature_c"],c["gpu_temperature_sustained_seconds"]): return f"GPU temperature {r.gpu_temperature_c:.0f}C sustained"
        if r.gpu_memory_used_mb is not None and r.gpu_memory_total_mb:
            pct=100*r.gpu_memory_used_mb/r.gpu_memory_total_mb
            if self.sustained("vram",pct>=c["gpu_memory_percent"],c["gpu_memory_sustained_seconds"]): return f"GPU memory {pct:.1f}% sustained"
        if time.monotonic()-self.last_activity>c["stalled_progress_minutes"]*60: return f"no progress for {c['stalled_progress_minutes']} minutes"
        if time.monotonic()-self.started>self.config["run"]["max_hours"]*3600: return "maximum runtime reached"
    def monitor(self):
        wait=self.config["resources"]["sample_seconds"]
        while not self.stop_event.wait(wait):
            if self.stop_file.exists(): self.stop("manual STOP file detected"); break
            r=self.snapshot(); self.append("resources.jsonl",asdict(r)); reason=self.unsafe(r)
            if reason: self.stop(reason); break

    def class_metrics(self,class_id):
        try: p,r,m50,m95=self.trainer.validator.metrics.class_result(class_id); return {"precision":number(p),"recall":number(r),"map50":number(m50),"map50_95":number(m95)}
        except (AttributeError,IndexError,TypeError): return {"precision":0.0,"recall":0.0,"map50":0.0,"map50_95":0.0}
    def score_metrics(self,overall,overflow):
        w=self.config["selection"]["weights"]
        return w["overflow_f2"]*f2(overflow["precision"],overflow["recall"])+w["overflow_map50"]*overflow["map50"]+w["overall_map50"]*overall["map50"]+w["overall_map50_95"]*overall["map50_95"]
    def validate_domains(self,checkpoint,epoch):
        domain_config=self.config["selection"].get("domain_validation")
        if not domain_config: return None
        import torch
        from ultralytics import YOLOE
        results={}; class_id=int(self.config["selection"].get("overflow_class_id",1))
        for domain,yaml_name in domain_config["datasets"].items():
            yaml_path=Path(yaml_name); yaml_path=yaml_path if yaml_path.is_absolute() else self.root/yaml_path
            self.event("domain_validation_started",epoch=epoch,domain=domain,dataset=str(yaml_path))
            model=YOLOE(str(checkpoint))
            metrics=model.val(data=str(yaml_path),split="val",imgsz=self.config["run"]["imgsz"],batch=self.config["run"]["batch"],device=0,workers=0,plots=False,verbose=False,project=str(self.log_dir/"domain_validation"),name=f"epoch_{epoch}_{domain}",exist_ok=True)
            values=metrics.results_dict; p,r,m50,m95=metrics.class_result(class_id)
            overall={"precision":number(values.get("metrics/precision(B)")),"recall":number(values.get("metrics/recall(B)")),"map50":number(values.get("metrics/mAP50(B)")),"map50_95":number(values.get("metrics/mAP50-95(B)"))}
            overflow={"precision":number(p),"recall":number(r),"map50":number(m50),"map50_95":number(m95)}
            results[domain]={"overall":overall,"overflow":overflow,"score":self.score_metrics(overall,overflow)}
            self.event("domain_validation_completed",epoch=epoch,domain=domain,results=results[domain])
            del model,metrics
            torch.cuda.empty_cache()
        return results
    def on_epoch_end(self,trainer):
        self.trainer=trainer; self.last_activity=time.monotonic(); epoch=int(trainer.epoch)+1
        csv_path=Path(getattr(trainer,"csv",Path(trainer.save_dir)/"results.csv"))
        if csv_path.exists() and epoch>max(0,len(csv_path.read_text(encoding="utf-8").splitlines())-1):
            self.event("duplicate_final_validation_ignored",reported_epoch=epoch); return
        select=self.config["selection"]; overflow_class_id=int(select.get("overflow_class_id",2))
        raw_metrics=dict(trainer.metrics); metrics={k:number(v) for k,v in raw_metrics.items()}; overflow=self.class_metrics(overflow_class_id); w=select["weights"]
        m50=metrics.get("metrics/mAP50(B)",0); m95=metrics.get("metrics/mAP50-95(B)",0)
        score=w["overflow_f2"]*f2(overflow["precision"],overflow["recall"])+w["overflow_map50"]*overflow["map50"]+w["overall_map50"]*m50+w["overall_map50_95"]*m95
        required=[raw_metrics.get(k) for k in ("metrics/precision(B)","metrics/recall(B)","metrics/mAP50(B)","metrics/mAP50-95(B)","val/box_loss","val/cls_loss","val/dfl_loss")]
        gate=select.get("eligibility",{})
        eligible=self.stop_reason is None and all(v is not None and math.isfinite(float(v)) for v in required) and overflow["precision"]>=number(gate.get("overflow_precision"),0.0) and overflow["recall"]>=number(gate.get("overflow_recall"),0.0)
        last=Path(trainer.last); domains=self.validate_domains(last,epoch)
        if domains:
            score=min(row["score"] for row in domains.values())
            eligible=self.stop_reason is None and all(row["overflow"]["precision"]>=number(gate.get("overflow_precision"),0.0) and row["overflow"]["recall"]>=number(gate.get("overflow_recall"),0.0) for row in domains.values())
        resource=self.snapshot(); record={"timestamp":now(),"epoch":epoch,"epoch_seconds":time.monotonic()-self.epoch_started,"elapsed_seconds":time.monotonic()-self.started,"train_losses":[number(x) for x in trainer.tloss],"overall":metrics,"overflow":overflow,"domains":domains,"selection_score":score,"eligible_for_selection":eligible,"resources":asdict(resource),"stop_reason":self.stop_reason}
        self.append("epochs.jsonl",record); controlled=Path(trainer.wdir)/"best_controlled.pt"; accepted=Path(trainer.wdir)/"best_accepted.pt"
        if trainer.best_fitness==trainer.fitness and Path(trainer.best).exists(): shutil.copy2(trainer.best,Path(trainer.wdir)/"best_ultralytics.pt")
        improved=eligible and epoch>=select["min_epoch"] and score>=self.best_score+select["min_improvement"]
        if improved and last.exists(): shutil.copy2(last,controlled); self.best_score=score; self.best_epoch=self.last_better=epoch; self.event("controlled_best_updated",epoch=epoch,score=score,overflow=overflow)
        if improved:
            (self.log_dir/"selection.json").write_text(json.dumps({"best_score":self.best_score,"best_epoch":self.best_epoch,"best_accepted_score":self.best_accepted_score},indent=2),encoding="utf-8")
        if controlled.exists(): shutil.copy2(controlled,trainer.best)
        a=select["acceptance"]; passed=overflow["precision"]>=a["overflow_precision"] and overflow["recall"]>=a["overflow_recall"] and m50>=a["overall_map50"]
        if domains: passed=all(row["overflow"]["precision"]>=a["overflow_precision"] and row["overflow"]["recall"]>=a["overflow_recall"] and row["overall"]["map50"]>=a["overall_map50"] for row in domains.values())
        accepted_improved=eligible and passed and score>=self.best_accepted_score+select["min_improvement"]
        if accepted_improved and last.exists():
            shutil.copy2(last,accepted); self.best_accepted_score=score; self.event("accepted_best_updated",epoch=epoch,score=score)
            (self.log_dir/"selection.json").write_text(json.dumps({"best_score":self.best_score,"best_epoch":self.best_epoch,"best_accepted_score":self.best_accepted_score},indent=2),encoding="utf-8")
        if self.last_better>=0 and epoch-self.last_better>=select["plateau_patience"]: self.stop(f"selection score plateaued for {select['plateau_patience']} epochs")
        state={"status":"stopping" if trainer.stop or self.stop_event.is_set() else "training","run":self.run_name,"epoch":epoch,"epochs":trainer.epochs,"latest":record,"best_epoch":self.best_epoch,"best_score":self.best_score,"best_accepted_score":self.best_accepted_score,"current_epoch_accepted":passed,"stop_reason":self.stop_reason,"paths":{"last":str(last),"best":str(trainer.best),"controlled":str(controlled),"accepted":str(accepted)}}
        (self.log_dir/"state.json").write_text(json.dumps(state,indent=2),encoding="utf-8")
        self.write_live("epoch_complete",True)
        print(f"CONTROL epoch={epoch}/{trainer.epochs} time={record['epoch_seconds']:.1f}s P={metrics.get('metrics/precision(B)',0):.3f} R={metrics.get('metrics/recall(B)',0):.3f} mAP50={m50:.3f} overflow_P={overflow['precision']:.3f} overflow_R={overflow['recall']:.3f} score={score:.4f} best={self.best_score:.4f}",flush=True)
    def finish(self,trainer):
        self.stop_event.set(); summary={"timestamp":now(),"status":"stopped" if self.stop_reason else "completed","stop_reason":self.stop_reason,"best_epoch":self.best_epoch,"best_score":self.best_score,"last_checkpoint":str(getattr(trainer,"last","")),"best_checkpoint":str(getattr(trainer,"best",""))}
        (self.log_dir/"summary.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
        state_path=self.log_dir/"state.json"
        if state_path.exists():
            state=json.loads(state_path.read_text(encoding="utf-8")); state["status"]=summary["status"]; state["stop_reason"]=self.stop_reason; state_path.write_text(json.dumps(state,indent=2),encoding="utf-8")
        self.event("controller_finished",**summary)
        self.write_live(summary["status"],True)
