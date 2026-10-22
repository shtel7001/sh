#!/usr/bin/env python3
"""Autonomous sequential 20-stock KRX collection; persist progress, never fabricate missing data."""
import json, os, subprocess, sys
from pathlib import Path

OUT=Path("public/krx-investor-data")
OUT.mkdir(parents=True,exist_ok=True)
PROGRESS=OUT/"_autocollect_progress.json"
p=json.loads(PROGRESS.read_text()) if PROGRESS.exists() else {"nextStart":440,"universeCount":2695,"days":240,"batchSize":20,"completedChunks":0}
start=p["nextStart"]
if start>=p["universeCount"]:
    print("FINISHED",p,flush=True)
    sys.exit(0)
for index in range(start,min(start+200,p["universeCount"]),20):
    count=min(20,p["universeCount"]-index)
    cmd=[sys.executable,"scripts/export_krx_investor_market_batch.py","--market","BOTH","--start",str(index),"--count",str(count),"--days","240","--asof","20261022"]
    print("RUN",index,count,flush=True)
    result=subprocess.run(cmd,check=False)
    report=OUT/f"_batch_{index}.json"
    if not report.exists():
        raise RuntimeError(f"No KRX report at index {index}; cannot safely advance")
    data=json.loads(report.read_text())
    if data["start"]!=index or data["count"]!=count or data["days"]!=240:
        raise RuntimeError(f"Unexpected KRX batch metadata at index {index}")
    if data["universeCount"]!=p["universeCount"]:
        raise RuntimeError("Universe changed; stop to avoid skipped/duplicated tickers")
    print("BATCH",index,"success",len(data["success"]),"failed",len(data["failures"]),"exit",result.returncode,flush=True)
    p["nextStart"]=index+count
    p["completedChunks"]=p.get("completedChunks",0)+1
    PROGRESS.write_text(json.dumps(p,indent=2)+"\n")
print("CHECKPOINT",p,flush=True)
