// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { isHistoricalAuthed } from '@/lib/historical-spike-auth';

export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';

const UA='Mozilla/5.0 (Linux; Android 16; Mobile) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function clamp(n:number,a:number,b:number){return Math.max(a,Math.min(b,n));}
function avg(a:number[]){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0;}
function pct(a:number,b:number){return b?(a/b-1)*100:0;}
function num(v:any,d=0){if(v===null||v===undefined)return d;const x=Number(String(v).replace(/,/g,'').replace(/[^0-9+\-.]/g,''));return Number.isFinite(x)?x:d;}
function addDays(s:string,n:number){const d=new Date(`${s}T12:00:00+09:00`);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);}
function ymd(s:string){return String(s||'').replace(/\D/g,'').slice(0,8);}
function iso(s:string){const x=ymd(s);return x.length===8?`${x.slice(0,4)}-${x.slice(4,6)}-${x.slice(6,8)}`:'';}
function pickRows(j:any){if(Array.isArray(j))return j;for(const k of ['priceInfos','prices','data','items','result'])if(Array.isArray(j?.[k]))return j[k];for(const k of ['data','result'])for(const kk of ['priceInfos','prices','items'])if(Array.isArray(j?.[k]?.[kk]))return j[k][kk];return[];}
async function fetchJson(url:string,attempts=3){let last='';for(let i=0;i<attempts;i++){const c=new AbortController(),t=setTimeout(()=>c.abort(),12000);try{const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/json,text/plain,*/*','referer':'https://m.stock.naver.com/'},signal:c.signal,cache:'no-store'});if(r.ok)return await r.json();last=`HTTP ${r.status}`;}catch(e:any){last=String(e?.message||e);}finally{clearTimeout(t);}await sleep(180*(i+1)+Math.floor(Math.random()*100));}throw new Error(last||'FETCH_FAILED');}
async function bars(code:string,asOf:string){
  const start=ymd(addDays(asOf,-200)),end=ymd(asOf),u=`https://api.stock.naver.com/chart/domestic/item/${encodeURIComponent(code)}?periodType=dayCandle&startDateTime=${start}&endDateTime=${end}`;
  const raw=pickRows(await fetchJson(u,3));if(!raw.length)throw new Error('EMPTY_CHART');
  const a=raw.map((b:any)=>({date:iso(b?.localDate)||String(b?.localTradedAt||''),open:num(b?.openPrice),high:num(b?.highPrice),low:num(b?.lowPrice),close:num(b?.closePrice),volume:num(b?.accumulatedTradingVolume)})).filter((b:any)=>b.date&&b.close>0&&b.date<=asOf).sort((x:any,y:any)=>x.date.localeCompare(y.date));
  if(!a.length)throw new Error('NO_BARS');
  return a.map((b:any,i:number)=>({...b,change:i?pct(b.close,a[i-1].close):0})).reverse();
}
async function one(s:any,c:any){
  try{
    const b=await bars(String(s.code),c.asOf),need=Math.max(Math.max(c.spikeFrom,c.spikeTo)+21,35);if(b.length<need)return{kind:'insufficient',code:s.code,count:b.length};
    const from=clamp(Math.min(c.spikeFrom,c.spikeTo),1,30),to=clamp(Math.max(c.spikeFrom,c.spikeTo),1,30),lo=Math.min(c.spikeMin,c.spikeMax),hi=Math.max(c.spikeMin,c.spikeMax),sp:any[]=[];
    for(let off=from;off<=to&&off<b.length;off++){const x=b[off];if(x.change<lo||x.change>hi)continue;const pv=b.slice(off+1,off+21).map((z:any)=>z.volume).filter((v:number)=>v>0),vr=avg(pv)>0?x.volume/avg(pv):0;sp.push({...x,offset:off,volRatio:vr});}
    if(!sp.length)return{kind:'no_spike',code:s.code};sp.sort((x,y)=>(y.change+Math.min(10,y.volRatio*2))-(x.change+Math.min(10,x.volRatio*2))||x.offset-y.offset);
    const hit=sp[0],cur=b[0],rd=clamp(c.recentDays,1,20),recent=b.slice(0,rd),old=recent[recent.length-1]||cur,v5=avg(b.slice(0,5).map((x:any)=>x.volume)),v20=avg(b.slice(0,20).map((x:any)=>x.volume)),ma5=avg(b.slice(0,5).map((x:any)=>x.close)),ma20=avg(b.slice(0,20).map((x:any)=>x.close)),rr=pct(cur.close,old.close),rv=v20?v5/v20:0,m5=pct(cur.close,ma5),m20=pct(cur.close,ma20),l20=b.slice(0,20).map((x:any)=>x.low).filter((x:number)=>x>0),pos=l20.length?pct(cur.close,Math.min(...l20)):0;
    let tech=36;tech+=clamp((hit.change-lo)/Math.max(1,hi-lo)*18,0,18)+clamp(hit.volRatio*4,0,14)+clamp((rr+6)*1.4,0,18)+clamp(rv*5,0,10);if(m5>=-3&&m5<=8)tech+=5;if(m20>=-8&&m20<=12)tech+=5;tech-=clamp(Math.max(0,pos-35)/4,0,10);tech=clamp(Math.round(tech),0,100);
    return{kind:'hit',row:{code:String(s.code),name:String(s.name),market:String(s.market||''),asOf:cur.date,currentPrice:cur.close,currentChange:Number(cur.change.toFixed(2)),spikeDate:hit.date,spikePct:Number(hit.change.toFixed(2)),spikeOffset:hit.offset,spikeVolumeRatio:Number(hit.volRatio.toFixed(2)),recentFrom:old.date,recentDays:rd,recentReturnPct:Number(rr.toFixed(2)),recentVolumeRatio:Number(rv.toFixed(2)),ma5Pct:Number(m5.toFixed(2)),ma20Pct:Number(m20.toFixed(2)),technicalScore:tech,naver:`https://finance.naver.com/item/main.naver?code=${s.code}`,naverNews:`https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(String(s.name)+' 주식')}`}};
  }catch(e:any){return{kind:'fetch_error',code:s.code,error:String(e?.message||e)};}
}
async function pool(items:any[],limit:number,fn:(x:any)=>Promise<any>){const out=new Array(items.length);let p=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const i=p++;if(i>=items.length)break;out[i]=await fn(items[i]);}}));return out;}
function cfg(v:any){const g=(x:any,d:number)=>Number.isFinite(Number(x))?Number(x):d;return{asOf:String(v?.asOf||''),spikeFrom:clamp(g(v?.spikeFrom,1),1,30),spikeTo:clamp(g(v?.spikeTo,30),1,30),spikeMin:clamp(g(v?.spikeMin,3),.1,30),spikeMax:clamp(g(v?.spikeMax,30),.1,30),recentDays:clamp(g(v?.recentDays,5),1,20)};}
export async function GET(){try{const b=await bars('005930',new Date().toISOString().slice(0,10));return NextResponse.json({ok:true,source:'Naver dayCandle',bars:b.length,newest:b[0],sample:b[5]});}catch(e:any){return NextResponse.json({ok:false,error:String(e?.message||e)},{status:502});}}
export async function POST(req:NextRequest){if(!isHistoricalAuthed(req))return NextResponse.json({ok:false,error:'AUTH_REQUIRED'},{status:401});const body=await req.json().catch(()=>({})),c=cfg(body?.cfg||{}),stocks=(Array.isArray(body?.stocks)?body.stocks:[]).slice(0,60);if(!stocks.length)return NextResponse.json({ok:false,error:'NO_STOCKS'},{status:400});const r=await pool(stocks,4,s=>one(s,c)),rows=r.filter(x=>x?.kind==='hit').map(x=>x.row),stats={requested:stocks.length,loaded:r.filter(x=>x?.kind!=='fetch_error').length,fetchErrors:r.filter(x=>x?.kind==='fetch_error').length,insufficient:r.filter(x=>x?.kind==='insufficient').length,noSpike:r.filter(x=>x?.kind==='no_spike').length,hits:rows.length};return NextResponse.json({ok:true,rows,stats,errors:r.filter(x=>x?.kind==='fetch_error').slice(0,5)});}
