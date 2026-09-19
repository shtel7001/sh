import { NextResponse } from 'next/server';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

async function jsonProbe(name:string,url:string,kind:'array'|'trend'|'yahoo'){
  try{
    const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/json,text/plain,*/*'},cache:'no-store'});
    const j=await r.json();
    let count=0;
    if(kind==='array') count=Array.isArray(j)?j.length:0;
    if(kind==='trend') count=Array.isArray(j?.result?.items)?j.result.items.length:0;
    if(kind==='yahoo') count=Array.isArray(j?.chart?.result?.[0]?.timestamp)?j.chart.result[0].timestamp.length:0;
    return {name,status:r.status,ok:r.ok,count,hasNext:j?.result?.hasNext??null};
  }catch(e:any){return {name,status:0,ok:false,count:0,error:e?.message||String(e)}}
}

export async function GET(){
  const p2=Math.floor(Date.now()/1000)+86400;
  const p1=p2-86400*730;
  const results=await Promise.all([
    jsonProbe('universe50','https://stock.naver.com/api/domestic/market/stock/default?tradeType=KRX&marketType=KOSPI&orderType=marketSum&startIdx=0&pageSize=50','array'),
    jsonProbe('trendDefault','https://m.stock.naver.com/front-api/stock/domestic/trend?code=005930','trend'),
    jsonProbe('trend20','https://m.stock.naver.com/front-api/stock/domestic/trend?code=005930&page=1&pageSize=20','trend'),
    jsonProbe('price260','https://m.stock.naver.com/api/stock/005930/price?pageSize=260&page=1','array'),
    jsonProbe('yahoo2y',`https://query1.finance.yahoo.com/v8/finance/chart/005930.KS?period1=${p1}&period2=${p2}&interval=1d&events=history&includeAdjustedClose=true`,'yahoo'),
  ]);
  return NextResponse.json({results,at:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
}
