#!/usr/bin/env python3
"""Collect KRX-only investor flows. Requires: pip install pykrx
Run: python scripts/collect_krx_yellow_bar.py --days 240 --as-of 20261022
Never stores KRX credentials. Do not publish until KRX collection is validated.
"""
import argparse
import json
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from pykrx import stock

GROUPS = ("금융투자", "보험", "투신", "사모", "은행", "기타금융", "연기금", "기타법인", "개인", "외국인", "기타외국인")\nREQUIRED = ("금융투자", "보험", "투신", "사모", "은행", "기타금융", "연기금", "개인", "외국인")
INSTITUTION = ("금융투자", "보험", "투신", "사모", "은행", "기타금융", "연기금")

def normalize_frame(frame):
    if frame is None or frame.empty:
        return {}
    result = {}
    for dt, series in frame.iterrows():
        date = dt.strftime("%Y%m%d") if hasattr(dt, "strftime") else re.sub(r"\D", "", str(dt))[:8]
        if not re.fullmatch(r"\d{8}", date):
            continue
        row = {}
        for group in GROUPS:
            value = series.get(group)
            if value is None or str(value) == "nan":
                row[group] = None
            else:
                row[group] = int(value)
        result[date] = row
    return result

def collect_ticker(ticker, asof, days):
    # Calendar padding covers holidays; never manufacture missing trading sessions.
    start = (datetime.strptime(asof, "%Y%m%d") - timedelta(days=max(365, days * 2 + 35))).strftime("%Y%m%d")
    quantities = normalize_frame(stock.get_market_trading_volume_by_date(start, asof, ticker, on="순매수"))
    values = normalize_frame(stock.get_market_trading_value_by_date(start, asof, ticker, on="순매수"))
    dates = sorted(set(quantities) & set(values), reverse=True)[:days]
    rows = []
    for date in dates:
        q, v = quantities[date], values[date]
        if any(q.get(g) is None or v.get(g) is None for g in REQUIRED):
            continue
        rows.append({"date": date, "netBuyQuantity": q, "netBuyValueKRW": v})
    return rows

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--as-of", default=datetime.now().strftime("%Y%m%d"))
    parser.add_argument("--days", type=int, default=240)
    parser.add_argument("--delay", type=float, default=0.35)
    parser.add_argument("--market", choices=("ALL", "KOSPI", "KOSDAQ"), default="ALL")
    parser.add_argument("--limit", type=int, default=0, help="Test only first N securities; 0=all")
    args = parser.parse_args()
    if not re.fullmatch(r"\d{8}", args.as_of) or not 1 <= args.days <= 250:
        parser.error("invalid as-of or days")
    out = Path("public/krx-investor-data")
    out.mkdir(parents=True, exist_ok=True)
    markets = ("KOSPI", "KOSDAQ") if args.market == "ALL" else (args.market,)
    tickers = []
    for market in markets:
        for ticker in stock.get_market_ticker_list(args.as_of, market=market):
            tickers.append({"code": ticker, "name": stock.get_market_ticker_name(ticker), "market": market})
    if args.limit:
        tickers = tickers[:args.limit]
    verified, failures = [], []
    for i, item in enumerate(tickers, 1):
        ticker = item["code"]
        try:
            rows = collect_ticker(ticker, args.as_of, args.days)
            if not rows:
                raise ValueError("NO_VERIFIED_KRX_ROWS")
            payload = {"source": "KRX via pykrx", "ticker": ticker, "asOf": args.as_of,
                       "requestedDays": args.days, "actualDays": len(rows),
                       "unitQuantity": "shares", "unitValue": "KRW",
                       "newest": rows[0]["date"], "oldest": rows[-1]["date"], "rows": rows}
            path = out / f"{ticker}.json"
            temp = path.with_suffix(".tmp")
            temp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            temp.replace(path)
            verified.append(item)
            print(f"{i}/{len(tickers)} OK {ticker} {len(rows)}", flush=True)
        except Exception as exc:
            failures.append({"code": ticker, "error": str(exc)[:180]})
            print(f"{i}/{len(tickers)} FAIL {ticker}: {exc}", flush=True)
        time.sleep(max(0, args.delay))
    manifest = {"source": "KRX via pykrx", "asOf": args.as_of, "requestedDays": args.days,
                "complete": not failures and not args.limit, "stocks": verified, "failed": failures}
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"verified={len(verified)} failed={len(failures)}; manifest complete={manifest['complete']}")
    if failures:
        raise SystemExit(2)

if __name__ == "__main__":
    main()
