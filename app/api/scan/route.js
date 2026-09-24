import {NextResponse} from 'next/server';
import {isAuthed} from '../_lib/auth';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const pct=(a,b)=>b?(a/b-1)*100:0;

async function yahoo(sym,days){
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d&includePrePost=false&events=div%2Csplits`,{headers:{'User-Agent':'Mozilla/5.0 low-retest-radar/1.0'},cache:'no-store'});
  if(!r.ok)throw new Error(`Yahoo ${r.status}`);const j=await r.json(),x=j?.chart?.result?.[0];if(!x)throw new Error('Yahoo no data');const q=x.indicators?.quote?.[0]||{};const out=[];
  (x.timestamp||[]).forEach((t,i)=>{const open=Number(q.open?.[i]),high=Number(q.high?.[i]),low=Number(q.low?.[i]),close=Number(q.close?.[i]),volume=Number(q.volume?.[i]||0);if([open,high,low,close].every(v=>Number.isFinite(v)&&v>0))out.push({date:new Date(t*1000).toISOString().slice(0,10),open,high,low,close,volume})});
  if(out.length<Math.min(days,12))throw new Error('Yahoo short');return out.slice(-days);
}
async function daum(code,days){
  const symbol=`A${code}`,u=new URL(`https://finance.daum.net/api/charts/${symbol}/days`);u.searchParams.set('limit',String(Math.min(260,Math.max(days+10,30))));u.searchParams.set('adjusted','true');
  const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0 low-retest-radar/1.0',Accept:'application/json, text/plain, */*',Referer:`https://finance.daum.net/quotes/${symbol}`},cache:'no-store'});if(!r.ok)throw new Error(`Daum chart ${r.status}`);const j=await r.json();
  const out=(j?.data||[]).map(x=>({date:String(x.date||x.candleTime||'').slice(0,10),open:Number(x.openingPrice||x.openPrice||x.tradePrice),high:Number(x.highPrice||x.tradePrice),low:Number(x.lowPrice||x.tradePrice),close:Number(x.tradePrice),volume:Number(x.candleAccTradeVolume||x.accTradeVolume||0)})).filter(x=>x.date&&[x.open,x.high,x.low,x.close].every(v=>Number.isFinite(v)&&v>0));out.sort((a,b)=>a.date.localeCompare(b.date));if(out.length<Math.min(days,12))throw new Error('Daum chart short');return out.slice(-days);
}
async function history(s,days){try{return {rows:await yahoo(s.yahoo,days),source:'Yahoo'}}catch{return {rows:await daum(s.code,days),source:'Daum'}}}

function analyze(s,rows,c){
  const n=rows.length;if(n<Math.max(12,c.lowPeakGap+c.peakNowGap+3))return null;const current=rows[n-1],lastPeak=n-1-c.peakNowGap;let best=null,runningMin=Infinity;
  for(let i=0;i<=lastPeak-c.lowPeakGap;i++){
    const low=rows[i].low;runningMin=Math.min(runningMin,low);if(low>runningMin*1.000001)continue;
    let peak=-Infinity,peakIdx=-1;for(let j=i+c.lowPeakGap;j<=lastPeak;j++){if(rows[j].high>peak){peak=rows[j].high;peakIdx=j}}
    if(peakIdx<0)continue;
    if(c.strictLow){let bad=false;for(let k=i+1;k<=peakIdx;k++){if(rows[k].low<low){bad=true;break}}if(bad)continue}
    const rise=pct(peak,low);if(rise<c.riseMin||rise>c.riseMax)continue;const ret=pct(current.close,low);if(ret<c.retMin||ret>c.retMax)continue;const draw=pct(current.close,peak);
    const hit={...s,current:current.close,lowPrice:low,lowDate:rows[i].date,peakPrice:peak,peakDate:rows[peakIdx].date,risePct:rise,returnPct:ret,drawdownPct:draw,lowToPeak:peakIdx-i,peakToNow:n-1-peakIdx,spark:rows.slice(-60).map(r=>[r.date,r.close])};
    if(!best||Math.abs(hit.returnPct)<Math.abs(best.returnPct)||(Math.abs(hit.returnPct)===Math.abs(best.returnPct)&&hit.lowDate>best.lowDate))best=hit;
  }
  return best;
}
async function one(s,c){try{const h=await history(s,c.days),hit=analyze(s,h.rows,c);return {ok:true,source:h.source,hit:hit?{...hit,source:h.source}:null}}catch(e){return {ok:false,code:s.code,name:s.name,error:String(e?.message||e)}}}
export async function POST(req){
  if(!isAuthed(req))return NextResponse.json({ok:false,error:'AUTH_REQUIRED'},{status:401});
  try{const b=await req.json();const c={days:Math.min(120,Math.max(20,Number(b.days||60))),riseMin:Number(b.riseMin??10),riseMax:Number(b.riseMax??30),retMin:Number(b.retMin??-5),retMax:Number(b.retMax??10),lowPeakGap:Math.min(20,Math.max(1,Number(b.lowPeakGap||1))),peakNowGap:Math.min(20,Math.max(1,Number(b.peakNowGap||1))),strictLow:b.strictLow!==false};
    if(c.riseMin>c.riseMax)[c.riseMin,c.riseMax]=[c.riseMax,c.riseMin];if(c.retMin>c.retMax)[c.retMin,c.retMax]=[c.retMax,c.retMin];const stocks=Array.isArray(b.stocks)?b.stocks.slice(0,25):[];const z=await Promise.all(stocks.map(s=>one(s,c)));
    return NextResponse.json({ok:true,scanned:stocks.length,hits:z.filter(x=>x.ok&&x.hit).map(x=>x.hit),errors:z.filter(x=>!x.ok),sources:z.filter(x=>x.ok).reduce((a,x)=>(a[x.source]=(a[x.source]||0)+1,a),{})});
  }catch(e){return NextResponse.json({ok:false,error:String(e?.message||e)},{status:500})}
}
