import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
type Item={code:string;market:'KOSPI'|'KOSDAQ'};
type Spike={date:string;rate:number;close:number};

function num(v:unknown){
  const x=Number(String(v??'').replace(/,/g,'').replace(/[^0-9+.-]/g,''));
  return Number.isFinite(x)?x:0;
}
function sleep(ms:number){return new Promise(r=>setTimeout(r,ms));}
async function fetchRetry(url:string,retries=2){
  let last:unknown;
  for(let i=0;i<=retries;i++){
    const c=new AbortController(); const t=setTimeout(()=>c.abort(),12000);
    try{
      const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/json,text/plain,*/*'},signal:c.signal,cache:'no-store'});
      if(r.ok) return r;
      last=new Error(`HTTP ${r.status}`);
    }catch(e){last=e;}finally{clearTimeout(t);}
    if(i<retries) await sleep(180*(i+1));
  }
  throw last instanceof Error?last:new Error('history fetch failed');
}
function kstDate(ts:number){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ts*1000));
}

async function yahoo(item:Item){
  const suffix=item.market==='KOSPI'?'KS':'KQ';
  const p2=Math.floor(Date.now()/1000)+86400;
  const p1=p2-86400*730;
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${item.code}.${suffix}?period1=${p1}&period2=${p2}&interval=1d&events=history&includeAdjustedClose=true`;
  const r=await fetchRetry(url,1);
  const j=await r.json();
  const result=j?.chart?.result?.[0];
  const ts:Array<number>=result?.timestamp||[];
  const closes:Array<number|null>=result?.indicators?.quote?.[0]?.close||[];
  const bars=ts.map((t,i)=>({date:kstDate(t),close:Number(closes[i])})).filter(x=>Number.isFinite(x.close)&&x.close>0).slice(-241);
  if(bars.length<20) throw new Error('Yahoo history too short');
  const spikes:Spike[]=[];
  for(let i=1;i<bars.length;i++){
    const rate=(bars[i].close/bars[i-1].close-1)*100;
    if(rate>=10) spikes.push({date:bars[i].date,rate:Number(rate.toFixed(2)),close:bars[i].close});
  }
  return {spikes,tradingDays:Math.min(240,bars.length-1),source:'Yahoo Finance'};
}

async function naver(item:Item){
  const r=await fetchRetry(`https://m.stock.naver.com/api/stock/${item.code}/price?pageSize=260&page=1`,1);
  const j=await r.json();
  const rows=(Array.isArray(j)?j:[]).map((x:any)=>({date:String(x?.localTradedAt||''),close:num(x?.closePrice),rate:num(x?.fluctuationsRatio)})).filter((x:any)=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&x.close>0).slice(0,240);
  if(rows.length<20) throw new Error('Naver history too short');
  const spikes:Spike[]=rows.filter((x:any)=>x.rate>=10).map((x:any)=>({date:x.date,rate:Number(x.rate.toFixed(2)),close:x.close}));
  return {spikes,tradingDays:Math.min(240,rows.length),source:'Naver Finance fallback'};
}

async function one(item:Item){
  try{return {...await yahoo(item),code:item.code,market:item.market,error:null};}
  catch(e:any){
    try{return {...await naver(item),code:item.code,market:item.market,error:`Yahoo: ${e?.message||'failed'}`};}
    catch(e2:any){return {code:item.code,market:item.market,spikes:[],tradingDays:0,source:'failed',error:`${e?.message||'Yahoo failed'} / ${e2?.message||'Naver failed'}`};}
  }
}

async function pooled<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>){
  const out:R[]=new Array(items.length);let next=0;
  async function run(){while(true){const i=next++;if(i>=items.length)break;out[i]=await fn(items[i]);}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>run()));return out;
}

export async function POST(req:NextRequest){
  if(!(await isAuthed())) return unauthorized();
  const body=await req.json().catch(()=>({items:[]}));
  const items:Item[]=(Array.isArray(body?.items)?body.items:[]).slice(0,25).map((x:any)=>({code:String(x?.code||''),market:x?.market==='KOSDAQ'?'KOSDAQ':'KOSPI'})).filter(x=>/^\d{6}$/.test(x.code));
  if(!items.length) return NextResponse.json({error:'종목 코드가 없습니다.'},{status:400});
  const rows=await pooled(items,6,one);
  return NextResponse.json({rows,updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
}
