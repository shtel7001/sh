#!/usr/bin/env python3
"""KRX investor daily net-buy export. Run separately from the Vercel Next.js app.
Usage: python scripts/export_krx_investor_daily.py --ticker 005930 --days 120 --output krx-005930.json
pip install pykrx pandas
"""
import argparse
import datetime as dt
import json
import sys
from pathlib import Path

INVESTORS = ["금융투자", "보험", "투신", "사모", "은행", "기타금융", "연기금", "기타법인", "개인", "외국인", "기타외국인", "기관합계"]

def run(ticker: str, days: int, asof: str) -> dict:
    from pykrx import stock
    end = dt.datetime.strptime(asof, "%Y%m%d").date()
    # Calendar buffer: trading days exclude weekends and exchange holidays.
    start = end - dt.timedelta(days=max(60, int(days * 1.9) + 35))
    f, t = start.strftime("%Y%m%d"), end.strftime("%Y%m%d")
    # detail=True returns investor groups; '순매수' is daily net purchases.
    vol = stock.get_market_trading_volume_by_date(f, t, ticker, detail=True)
    val = stock.get_market_trading_value_by_date(f, t, ticker, detail=True)
    if vol is None or vol.empty or val is None or val.empty:
        raise RuntimeError("KRX_EMPTY: KRX returned no daily investor data; no zero filling")
    vol.index = vol.index.strftime("%Y%m%d")
    val.index = val.index.strftime("%Y%m%d")
    common = sorted(set(vol.index).intersection(val.index), reverse=True)
    if len(common) < days:
        raise RuntimeError(f"KRX_RANGE_SHORT_{len(common)}_NEED_{days}")
    rows = []
    for date in common[:days]:
        quantities, values = {}, {}
        for investor in INVESTORS:
            if investor in vol.columns and investor in val.columns:
                q, v = vol.at[date, investor], val.at[date, investor]
                if not (q == q and v == v):
                    raise RuntimeError(f"KRX_NAN_{date}_{investor}")
                quantities[investor] = int(q)
                values[investor] = int(v)
        for mandatory in ("금융투자", "보험", "투신", "사모", "은행", "연기금", "외국인"):
            if mandatory not in quantities:
                raise RuntimeError(f"KRX_MISSING_INVESTOR_{mandatory}")
        rows.append({"date": date, "netBuyQuantity": quantities, "netBuyValueKRW": values})
    return {"source": "KRX via pykrx", "ticker": ticker, "asOf": asof, "requestedDays": days,
            "actualDays": len(rows), "unitQuantity": "shares", "unitValue": "KRW",
            "newest": rows[0]["date"], "oldest": rows[-1]["date"], "rows": rows}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", default="005930")
    ap.add_argument("--days", type=int, default=120)
    ap.add_argument("--asof", default=dt.date.today().strftime("%Y%m%d"))
    ap.add_argument("--output", default="krx-investor-daily.json")
    args = ap.parse_args()
    if not (args.ticker.isdigit() and len(args.ticker) == 6 and 1 <= args.days <= 250):
        ap.error("ticker must be 6 digits; days must be 1..250")
    try:
        data = run(args.ticker, args.days, args.asof)
    except Exception as exc:
        print(f"KRX_FETCH_FAILED: {exc}", file=sys.stderr)
        sys.exit(2)
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK {data['ticker']} {data['actualDays']} trading days {data['oldest']}..{data['newest']} -> {path}")

if __name__ == "__main__":
    main()
