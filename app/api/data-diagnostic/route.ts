import { NextResponse } from 'next/server';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

async function probe(name:string,url:string){
  try{
    const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/json,text/plain,*/*'},cache:'no-store'});
    const text=await r.text();
    let parsed:any=null; try{parsed=JSON.parse(text);}catch{}
    const count=Array.isArray(parsed)?parsed.length:Array.isArray(parsed?.items)?parsed.items.length:Array.isArray(parsed?.content)?parsed.content.length:0;
    return {name,status:r.status,ok:r.ok,count,length:text.length,sample:text.slice(0,2500)};
  }catch(e:any){return {name,status:0,ok:false,count:0,error:e?.message||String(e)}}
}

export async function GET(){
  const results=await Promise.all([
    probe('newTrend20','https://stock.naver.com/api/domestic/detail/005930/trend?tradeType=KRX&startIdx=0&pageSize=20'),
    probe('newTrend20Next','https://stock.naver.com/api/domestic/detail/005930/trend?tradeType=KRX&startIdx=20&pageSize=20'),
    probe('newSiseDay20','https://stock.naver.com/api/domestic/detail/005930/siseDay?pageSize=20'),
  ]);
  return NextResponse.json({results,at:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
}
