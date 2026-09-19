import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

async function probe(name:string,url:string){
  try{
    const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/json,text/plain,*/*'},cache:'no-store'});
    const text=await r.text();
    return {name,status:r.status,ok:r.ok,contentType:r.headers.get('content-type'),length:text.length,sample:text.slice(0,1200)};
  }catch(e:any){return {name,status:0,ok:false,error:e?.message||String(e)}}
}

export async function GET(){
  const period2=Math.floor(Date.now()/1000);
  const period1=period2-86400*730;
  const results=await Promise.all([
    probe('universe','https://stock.naver.com/api/domestic/market/stock/default?tradeType=KRX&marketType=KOSPI&orderType=marketSum&startIdx=0&pageSize=5'),
    probe('trend','https://m.stock.naver.com/front-api/stock/domestic/trend?code=005930'),
    probe('price','https://m.stock.naver.com/api/stock/005930/price?pageSize=10&page=1'),
    probe('yahoo',`https://query1.finance.yahoo.com/v8/finance/chart/005930.KS?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`),
  ]);
  return NextResponse.json({results,at:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
}
