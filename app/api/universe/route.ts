import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';
import { fetchUniverse, type UniverseStock } from '@/lib/market';

export const runtime='nodejs';
export const maxDuration=60;
const UA='Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';
const n=(v:any)=>{if(typeof v==='number')return Number.isFinite(v)?v:null;if(typeof v!=='string')return null;const x=Number(v.replace(/[,+%원\s]/g,''));return Number.isFinite(x)?x:null};
const rowsOf=(j:any):any[]=>{if(Array.isArray(j))return j;for(const k of ['stocks','items','stockList','data'])if(Array.isArray(j?.[k]))return j[k];if(Array.isArray(j?.result?.stocks))return j.result.stocks;if(Array.isArray(j?.result?.items))return j.result.items;if(Array.isArray(j?.result))return j.result;return []};

function normalize(x:any,market:'KOSPI'|'KOSDAQ'):UniverseStock|null{
  const code=String(x?.itemCode??x?.itemcode??x?.stockCode??x?.code??'').match(/\d{6}/)?.[0]||'';
  const name=String(x?.stockName??x?.name??x?.itemName??'').trim();
  if(!code||!name)return null;
  return {name,code,market,currentPrice:n(x?.closePrice??x?.currentPrice??x?.nowVal??x?.price),changePct:n(x?.fluctuationsRatio??x?.changeRate??x?.changePct??x?.rate),marketCap:n(x?.marketValue??x?.marketCap??x?.marketValueAmount),sector:null,theme:null};
}
async function page(market:'KOSPI'|'KOSDAQ',p:number){
  const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),8500);
  try{
    const r=await fetch(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${p}&pageSize=100`,{signal:ctl.signal,headers:{'User-Agent':UA,'Accept':'application/json,text/plain,*/*','Accept-Language':'ko-KR,ko;q=0.9','Referer':'https://m.stock.naver.com/'},cache:'no-store'});
    if(!r.ok)throw new Error(`${market} ${p}p HTTP ${r.status}`);
    return rowsOf(await r.json());
  }finally{clearTimeout(t);}
}
async function fullMarket(market:'KOSPI'|'KOSDAQ'){
  const out:UniverseStock[]=[];const seen=new Set<string>();
  for(let p=1;p<=30;p++){
    const rows=await page(market,p);if(!rows.length)break;
    let added=0;
    for(const x of rows){const s=normalize(x,market);if(s&&!seen.has(s.code)){seen.add(s.code);out.push(s);added++;}}
    if(rows.length<100||added===0)break;
  }
  return out;
}

export async function GET(){
  if(!await isAuthed())return unauthorized();
  const errors:string[]=[];let stocks:UniverseStock[]=[];let source='NAVER mobile-json full market';
  try{
    const [kospi,kosdaq]=await Promise.all([fullMarket('KOSPI'),fullMarket('KOSDAQ')]);
    stocks=[...kospi,...kosdaq];
    if(kospi.length<500||kosdaq.length<700)throw new Error(`수집량 부족 KOSPI ${kospi.length}, KOSDAQ ${kosdaq.length}`);
  }catch(e){
    errors.push(e instanceof Error?e.message:'전종목 수집 실패');
    try{const f=await fetchUniverse();stocks=f.stocks;errors.push(...f.errors);source=`fallback ${f.sources.join(', ')}`;}catch(e2){errors.push(e2 instanceof Error?e2.message:'fallback 실패');}
  }
  stocks=[...new Map(stocks.map(s=>[`${s.market}-${s.code}`,s])).values()];
  if(!stocks.length)return NextResponse.json({error:'코스피·코스닥 종목목록 수집 실패',errors,stocks:[]},{status:502});
  return NextResponse.json({stocks,source,errors,count:stocks.length,kospi:stocks.filter(x=>x.market==='KOSPI').length,kosdaq:stocks.filter(x=>x.market==='KOSDAQ').length,updatedAt:new Date().toISOString()});
}
