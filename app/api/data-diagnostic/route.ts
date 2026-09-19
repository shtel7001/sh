import { NextResponse } from 'next/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
async function probe(name:string,url:string){
  try{
    const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/json,text/plain,*/*'},cache:'no-store'});
    const text=await r.text(); let parsed:any=null;try{parsed=JSON.parse(text);}catch{}
    return {name,status:r.status,ok:r.ok,length:text.length,keys:parsed&&typeof parsed==='object'?Object.keys(parsed):[],sample:text.slice(0,3500)};
  }catch(e:any){return {name,status:0,ok:false,error:e?.message||String(e)}}
}
export async function GET(){
  const results=await Promise.all([
    probe('newTrend20','https://stock.naver.com/api/domestic/detail/005930/trend?tradeType=KRX&startIdx=0&pageSize=20'),
    probe('dailyV2','https://stock.naver.com/api/stockSecurity/items/v2/domestic/005930/daily-prices?size=100')
  ]);
  return NextResponse.json({results,at:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
}
