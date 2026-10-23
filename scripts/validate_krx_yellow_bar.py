#!/usr/bin/env python3
"""Validate KRX yellow-bar collector outputs before any production deployment.
Usage: python scripts/validate_krx_yellow_bar.py [public/krx-investor-data]
"""
import json
import re
import sys
from datetime import datetime
from pathlib import Path

GROUPS = ("금융투자", "보험", "투신", "사모", "은행", "기타금융", "연기금", "개인", "외국인")

def validate(base):
    manifest_path = base / "manifest.json"
    if not manifest_path.exists():
        raise ValueError("KRX manifest missing; full-market collection not run")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("source") != "KRX via pykrx":
        raise ValueError("Unverified KRX manifest source")
    stocks = manifest.get("stocks")
    if not isinstance(stocks, list) or not stocks:
        raise ValueError("No verified securities")
    if manifest.get("complete") is not True or manifest.get("failed"):
        raise ValueError("Incomplete collection: production release blocked")
    seen = set()
    asof = manifest["asOf"]
    required_days = int(manifest["requestedDays"])
    for item in stocks:
        code = item["code"]
        if not re.fullmatch(r"\d{6}", code) or code in seen:
            raise ValueError("Invalid/duplicate ticker: " + str(code))
        seen.add(code)
        payload = json.loads((base / (code + ".json")).read_text(encoding="utf-8"))
        if payload.get("source") != "KRX via pykrx" or payload.get("ticker") != code:
            raise ValueError("Unverified source/ticker: " + code)
        rows = payload.get("rows", [])
        if not rows or len(rows) != payload.get("actualDays"):
            raise ValueError("Invalid row count: " + code)
        dates = [x["date"] for x in rows]
        if dates != sorted(set(dates), reverse=True):
            raise ValueError("Duplicate/unsorted dates: " + code)
        if dates[0] > asof:
            raise ValueError("Future row: " + code)
        for row in rows:
            datetime.strptime(row["date"], "%Y%m%d")
            for field in ("netBuyQuantity", "netBuyValueKRW"):
                values = row.get(field, {})
                for group in GROUPS:
                    if type(values.get(group)) is not int:
                        raise ValueError(f"Missing/non-integer {code} {row['date']} {field} {group}")
    print(f"KRX VERIFIED: {len(stocks)} securities, asOf={asof}, requestedDays={required_days}")

if __name__ == "__main__":
    try:
        validate(Path(sys.argv[1] if len(sys.argv) > 1 else "public/krx-investor-data"))
    except Exception as error:
        print("KRX VALIDATION FAILED:", error, file=sys.stderr)
        sys.exit(1)
