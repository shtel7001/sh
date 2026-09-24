import {NextResponse} from 'next/server';
import {isAuthed} from '../_lib/auth';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;

async function daumPage(market,page,perPage=100){
  const m=market==='kosdaq'?'KOSDAQ':'KOSPI';
  const u=new URL('https://finance.daum.net/api/trend/market_capitalization');
  u.searchParams.set('page',String(page));u.searchParams.set('perPage',String(perPage));u.searchParams.set('fieldName','marketCap');u.searchParams.set('order','desc');u.searchParams.set('market',m);u.searchParams.set('pagination','true');
  const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0 low-retest-radar/1.0',Accept:'application/json, text/plain, */*',Referer:'https://finance.daum.net/domestic/market_cap'},cache:'no-store'});
  if(!r.ok)throw new Error(`Daum ${m} ${r.status}`);const j=await r.json();return {rows:Array.isArray(j?.data)?j.data:[],total:Number(j?.totalCount||j?.totalElements||0)};
}
function normalize(row,market,rank){
  const code=String(row.symbolCode||'').replace(/^A/,'').replace(/\D/g,'');if(!/^\d{6}$/.test(code))return null;
  const marketCapWon=Number(row.marketCap);
  return {rank:Number(row.rank)||rank,code,name:String(row.name||code),current:Number(row.tradePrice)||null,marketCapEok:Number.isFinite(marketCapWon)?Math.round(marketCapWon/100000000):null,market:market==='kosdaq'?'KOSDAQ':'KOSPI',yahoo:`${code}.${market==='kosdaq'?'KQ':'KS'}`};
}
export async function GET(req){
  if(!isAuthed(req))return NextResponse.json({ok:false,error:'AUTH_REQUIRED'},{status:401});
  try{
    const s=new URL(req.url).searchParams,market=s.get('market')==='kosdaq'?'kosdaq':'kospi';const max=Math.min(2500,Math.max(100,Number(s.get('limit')||2500)));const all=[],seen=new Set();
    for(let page=1;page<=30&&all.length<max;page++){
      const {rows}=await daumPage(market,page,100);if(!rows.length)break;
      for(const row of rows){const x=normalize(row,market,all.length+1);if(!x||seen.has(x.code))continue;seen.add(x.code);all.push(x);if(all.length>=max)break}
      if(rows.length<100)break;
    }
    return NextResponse.json({ok:true,items:all,count:all.length,market:market.toUpperCase(),source:'Daum market capitalization'});
  }catch(e){return NextResponse.json({ok:false,error:String(e?.message||e)},{status:500})}
}
