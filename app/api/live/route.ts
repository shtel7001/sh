import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';

export const runtime='nodejs';
export const maxDuration=60;

type LiveStock={name:string;code:string;market:'KOSPI';rank?:number;currentPrice:number|null;changePct:number|null;marketCap:number|null;sector:null;theme:null;currentVolume:number;quoteDate:string};
const n=(v:any)=>{if(typeof v==='number')return Number.isFinite(v)?v:null;const x=Number(String(v??'').replace(/[, +%원]/g,''));return Number.isFinite(x)?x:null};
const kst=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

async function page(p:number){
  const url=`https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=${p}&pageSize=100&_=${Date.now()}`;
  let last='';
  for(let a=0;a<3;a++){
    const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),8000);
    try{
      const r=await fetch(url,{signal:ctl.signal,cache:'no-store',headers:{'User-Agent':'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36','Accept':'application/json, text/plain, */*','Accept-Language':'ko-KR,ko;q=0.9','Referer':'https://m.stock.naver.com/'}});clearTimeout(t);
      if(!r.ok){last=`HTTP ${r.status}`;await sleep(180*(a+1));continue;}
      const j=await r.json();
      const rows=Array.isArray(j)?j:Array.isArray(j?.stocks)?j.stocks:Array.isArray(j?.result?.stocks)?j.result.stocks:Array.isArray(j?.items)?j.items:Array.isArray(j?.result?.items)?j.result.items:Array.isArray(j?.data)?j.data:[];
      return rows;
    }catch(e){clearTimeout(t);last=e instanceof Error?e.message:'fetch error';await sleep(180*(a+1));}
  }
  throw new Error(last||'네이버 실시간 시세 수집 실패');
}

function norm(x:any):Omit<LiveStock,'rank'>|null{
  const code=String(x?.itemCode??x?.itemcode??x?.stockCode??x?.code??'').match(/\d{6}/)?.[0]||'';
  const name=String(x?.stockName??x?.name??x?.itemName??'').trim();
  if(!code||!name)return null;
  const traded=String(x?.localTradedAt??x?.tradedAt??x?.tradeDate??x?.date??'');
  const quoteDate=traded.match(/\d{4}-\d{2}-\d{2}/)?.[0]||kst();
  return {name,code,market:'KOSPI',currentPrice:n(x?.closePrice??x?.currentPrice??x?.nowVal??x?.price),changePct:n(x?.fluctuationsRatio??x?.changeRate??x?.changePct??x?.rate),marketCap:n(x?.marketValue??x?.marketCap??x?.marketValueAmount),sector:null,theme:null,currentVolume:n(x?.accumulatedTradingVolume??x?.volume??x?.tradingVolume)??0,quoteDate};
}

export async function POST(req:Request){
  if(!await isAuthed())return unauthorized();
  const body=await req.json().catch(()=>({}));
  const threshold=Math.max(1,Math.min(30,Number(body?.threshold)||1));
  try{
    const all:Omit<LiveStock,'rank'>[]=[];const seen=new Set<string>();
    for(let p=1;p<=20;p++){
      const rows=await page(p);if(!rows.length)break;let added=0;
      for(const x of rows){const s=norm(x);if(s&&!seen.has(s.code)){seen.add(s.code);all.push(s);added++;}}
      if(!added||rows.length<100)break;
    }
    if(all.length<500)throw new Error(`KOSPI 종목이 ${all.length}개만 수집되었습니다.`);
    const ranked:LiveStock[]=[...all].sort((a,b)=>(b.marketCap||0)-(a.marketCap||0)).map((x,i)=>({...x,rank:i+1}));
    const results=ranked.filter(x=>typeof x.changePct==='number'&&x.changePct>=threshold&&typeof x.currentPrice==='number').map(x=>{
      const rise=x.changePct as number,close=x.currentPrice as number,previous=rise>-99?Math.round(close/(1+rise/100)):0;
      return {...x,currentClose:close,currentDate:x.quoteDate,scannedDays:1,hits:[{date:x.quoteDate,previousClose:previous,close,risePct:rise,volume:x.currentVolume}],hitCount:1,maxRisePct:rise,latestHitDate:x.quoteDate,matched:true,dataStatus:'ok'};
    });
    const dates=[...new Set(ranked.map(x=>x.quoteDate).filter(Boolean))].sort();
    return NextResponse.json({results,universeCount:ranked.length,quoteDate:dates.at(-1)||kst(),threshold,source:'Naver Finance live quote',updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store, max-age=0'}});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'당일 시세 수집 실패'},{status:502});}
}
