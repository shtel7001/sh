#!/usr/bin/env python3
"""Collect verified KRX daily investor flow for a bounded market batch.
Never mark missing or short data as zero. Use GitHub Actions secrets KRX_ID/KRX_PW.
"""
import argparse
import datetime as dt
import json
import os
import time
from pathlib import Path
from pykrx import stock
from export_krx_investor_daily import run

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--market",choices=["KOSPI","KOSDAQ","BOTH"],default="BOTH")
    p.add_argument("--start",type=int,default=0)
    p.add_argument("--count",type=int,default=20)
    p.add_argument("--days",type=int,default=120)
    p.add_argument("--asof",default=dt.date.today().strftime("%Y%m%d"))
    p.add_argument("--out",default="public/krx-investor-data")
    a=p.parse_args()
    if not (0<=a.start and 1<=a.count<=100 and 1<=a.days<=250):
        p.error("invalid range")
    if not os.getenv("KRX_ID") or not os.getenv("KRX_PW"):
        p.error("KRX_ID/KRX_PW must be supplied through GitHub Secrets")
    markets=["KOSPI","KOSDAQ"] if a.market=="BOTH" else [a.market]
    universe=[]
    for m in markets:
        tickers=stock.get_market_ticker_list(date=a.asof,market=m)
        if not tickers: raise RuntimeError("KRX_UNIVERSE_EMPTY_"+m)
        universe.extend(tickers)
    # Exclude exchange-traded funds, notes and special-purpose acquisition companies.
    # KRX stock names provide an additional guard when ETF/ETN ticker lists are unavailable.
    excluded=set()
    for getter_name in ("get_etf_ticker_list","get_etn_ticker_list"):
        getter=getattr(stock,getter_name,None)
        if getter:
            try:
                excluded.update(getter(a.asof))
            except Exception as exc:
                print(f"WARN {getter_name} unavailable: {exc}",flush=True)
    def is_excluded(ticker):
        if ticker in excluded: return True
        name=str(stock.get_market_ticker_name(ticker) or "").upper().replace(" ","")
        return ("스팩" in name or "SPAC" in name or "ETF" in name or "ETN" in name)
    before=len(set(universe))
    universe=sorted(t for t in set(universe) if not is_excluded(t))
    print(f"FILTER excluded={before-len(universe)} eligible={len(universe)}",flush=True)
    chosen=universe[a.start:a.start+a.count]
    if not chosen: raise RuntimeError("EMPTY_BATCH")
    out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
    report={"asOf":a.asof,"market":a.market,"days":a.days,"start":a.start,"count":len(chosen),
            "universeCount":len(universe),"success":[],"failures":{}}
    for i,ticker in enumerate(chosen,1):
        try:
            result=run(ticker,a.days,a.asof)
            if result.get('partialHistory'):
                prices=stock.get_market_ohlcv_by_date('20000101',a.asof,ticker)
                if prices is None or prices.empty: raise RuntimeError('LISTING_UNVERIFIED')
                first=prices.index.min().strftime('%Y%m%d')
                if first < result['oldest']: raise RuntimeError('PARTIAL_NOT_IPO')
                result['newListingVerified']=True
                result['listingFirstTradingDate']=first
            (out/(ticker+".json")).write_text(json.dumps(result,ensure_ascii=False),encoding="utf-8")
            report["success"].append(ticker)
            print(f"OK {i}/{len(chosen)} {ticker} {result['actualDays']} days",flush=True)
        except Exception as e:
            report["failures"][ticker]=str(e)[:180]
            print(f"FAILED {i}/{len(chosen)} {ticker}: {e}",flush=True)
        time.sleep(0.4)
    (out/("_batch_"+str(a.start)+".json")).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"SUMMARY {len(report['success'])} success, {len(report['failures'])} failures; universe={len(universe)}",flush=True)
    if not report["success"]:raise RuntimeError("NO_VALID_KRX_RESULTS")

if __name__=="__main__":
    main()
