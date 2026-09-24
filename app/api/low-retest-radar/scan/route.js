import {NextResponse} from 'next/server';
import {isAuthed} from '../_lib/auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const pct=(a,b)=>b?(a/b-1)*100:0;
const clamp=(v,min,max)=>Math.min(max,Math.max(min,Number(v)));

async function yahoo(sym,days){
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d&includePrePost=false&events=div%2Csplits`,{headers:{'User-Agent':'Mozilla/5.0 low-retest-radar/2.0'},cache:'no-store'});
  if(!r.ok)throw new Error(`Yahoo ${r.status}`);
  const j=await r.json(),x=j?.chart?.result?.[0];
  if(!x)throw new Error('Yahoo no data');
  const q=x.indicators?.quote?.[0]||{},out=[];
  (x.timestamp||[]).forEach((t,i)=>{
    const open=Number(q.open?.[i]),high=Number(q.high?.[i]),low=Number(q.low?.[i]),close=Number(q.close?.[i]),volume=Number(q.volume?.[i]||0);
    if([open,high,low,close].every(v=>Number.isFinite(v)&&v>0))out.push({date:new Date(t*1000).toISOString().slice(0,10),open,high,low,close,volume});
  });
  if(out.length<Math.min(days,16))throw new Error('Yahoo short');
  return out.slice(-days);
}

async function daum(code,days){
  const symbol=`A${code}`,u=new URL(`https://finance.daum.net/api/charts/${symbol}/days`);
  u.searchParams.set('limit',String(Math.min(260,Math.max(days+15,40))));
  u.searchParams.set('adjusted','true');
  const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0 low-retest-radar/2.0',Accept:'application/json, text/plain, */*',Referer:`https://finance.daum.net/quotes/${symbol}`},cache:'no-store'});
  if(!r.ok)throw new Error(`Daum chart ${r.status}`);
  const j=await r.json();
  const out=(j?.data||[]).map(x=>({
    date:String(x.date||x.candleTime||'').slice(0,10),
    open:Number(x.openingPrice||x.openPrice||x.tradePrice),
    high:Number(x.highPrice||x.tradePrice),
    low:Number(x.lowPrice||x.tradePrice),
    close:Number(x.tradePrice),
    volume:Number(x.candleAccTradeVolume||x.accTradeVolume||0)
  })).filter(x=>x.date&&[x.open,x.high,x.low,x.close].every(v=>Number.isFinite(v)&&v>0));
  out.sort((a,b)=>a.date.localeCompare(b.date));
  if(out.length<Math.min(days,16))throw new Error('Daum chart short');
  return out.slice(-days);
}

async function history(s,days){
  try{return {rows:await yahoo(s.yahoo,days),source:'Yahoo'}}
  catch{return {rows:await daum(s.code,days),source:'Daum'}}
}

function overlapsZone(row,lo,hi,useIntraday){
  if(useIntraday)return row.low<=hi && row.high>=lo;
  return row.close>=lo && row.close<=hi;
}

function analyze(s,rows,c){
  const n=rows.length;
  const minNeed=Math.max(18,c.lowPeakMin+c.peakRetestMin+c.zoneDaysMin+2);
  if(n<minNeed)return null;
  const current=rows[n-1];
  let best=null;
  let runningMin=Infinity;

  for(let lowIdx=0;lowIdx<n-2;lowIdx++){
    const lowPrice=rows[lowIdx].low;
    runningMin=Math.min(runningMin,lowPrice);
    if(c.strictLow && lowPrice>runningMin*1.000001)continue;

    const peakStart=lowIdx+c.lowPeakMin;
    const peakEnd=Math.min(n-2,lowIdx+c.lowPeakMax);
    if(peakStart>peakEnd)continue;

    for(let peakIdx=peakStart;peakIdx<=peakEnd;peakIdx++){
      if(c.strictLow){
        let violated=false;
        for(let k=lowIdx+1;k<=peakIdx;k++){if(rows[k].low<lowPrice){violated=true;break}}
        if(violated)break;
      }
      const peakPrice=rows[peakIdx].high;
      const rise=pct(peakPrice,lowPrice);
      if(rise<c.riseMin||rise>c.riseMax)continue;

      const zoneLow=lowPrice*(1+c.zoneMin/100);
      const zoneHigh=lowPrice*(1+c.zoneMax/100);
      const retestStart=peakIdx+c.peakRetestMin;
      const retestEnd=Math.min(n-1,peakIdx+c.peakRetestMax);
      if(retestStart>retestEnd)continue;

      const touches=[];
      for(let k=retestStart;k<=retestEnd;k++){
        if(overlapsZone(rows[k],zoneLow,zoneHigh,c.useIntraday))touches.push(k);
      }
      if(!touches.length)continue;

      let longest=0,run=0;
      for(let k=retestStart;k<=retestEnd;k++){
        const insideClose=rows[k].close>=zoneLow&&rows[k].close<=zoneHigh;
        if(insideClose){run++;longest=Math.max(longest,run)}else run=0;
      }
      const touchDays=new Set(touches).size;
      const residence=c.useIntraday?Math.max(longest,touchDays):longest;
      if(residence<c.zoneDaysMin||residence>c.zoneDaysMax)continue;

      const firstRetest=touches[0],lastRetest=touches[touches.length-1];
      const retestAge=n-1-lastRetest;
      if(retestAge>c.retestRecentMax)continue;
      if(c.mode==='inside' && !(current.close>=zoneLow&&current.close<=zoneHigh))continue;

      const state=current.close>zoneHigh?'구간 상향 이탈':current.close<zoneLow?'구간 하향 이탈':'구간 안';
      const zoneMid=(zoneLow+zoneHigh)/2;
      const distancePct=pct(current.close,zoneMid);
      const drawdownPct=pct(current.close,peakPrice);
      const postPeakLow=Math.min(...rows.slice(peakIdx+1).map(r=>r.low));
      if(c.noNewLow && postPeakLow<lowPrice)continue;

      const hit={
        ...s,
        current:current.close,
        currentDate:current.date,
        lowPrice,lowDate:rows[lowIdx].date,
        peakPrice,peakDate:rows[peakIdx].date,
        risePct:rise,
        zoneLow,zoneHigh,
        firstRetestDate:rows[firstRetest].date,
        lastRetestDate:rows[lastRetest].date,
        retestPrice:rows[lastRetest].close,
        touchDays,
        residenceDays:residence,
        lowToPeak:peakIdx-lowIdx,
        peakToRetest:firstRetest-peakIdx,
        retestAge,
        currentState:state,
        distancePct,
        drawdownPct,
        spark:rows.slice(-Math.min(90,n)).map(r=>[r.date,r.close])
      };

      const score=(state==='구간 안'?0:Math.min(50,Math.abs(distancePct)))+retestAge*0.45-touchDays*0.08;
      hit.matchScore=score;
      if(!best||hit.matchScore<best.matchScore||(hit.matchScore===best.matchScore&&hit.lastRetestDate>best.lastRetestDate))best=hit;
    }
  }
  return best;
}

async function one(s,c){
  try{
    const h=await history(s,c.days),hit=analyze(s,h.rows,c);
    return {ok:true,source:h.source,hit:hit?{...hit,source:h.source}:null};
  }catch(e){return {ok:false,code:s.code,name:s.name,error:String(e?.message||e)}}
}

export async function POST(req){
  if(!isAuthed(req))return NextResponse.json({ok:false,error:'AUTH_REQUIRED'},{status:401});
  try{
    const b=await req.json();
    const c={
      days:clamp(b.days||60,30,180),
      riseMin:Number(b.riseMin??15),
      riseMax:Number(b.riseMax??100),
      zoneMin:Number(b.zoneMin??10),
      zoneMax:Number(b.zoneMax??25),
      lowPeakMin:clamp(b.lowPeakMin||3,1,40),
      lowPeakMax:clamp(b.lowPeakMax||20,2,60),
      peakRetestMin:clamp(b.peakRetestMin||2,1,40),
      peakRetestMax:clamp(b.peakRetestMax||30,2,70),
      zoneDaysMin:clamp(b.zoneDaysMin||2,1,30),
      zoneDaysMax:clamp(b.zoneDaysMax||20,1,50),
      retestRecentMax:clamp(b.retestRecentMax||20,0,60),
      mode:b.mode==='inside'?'inside':'recent',
      useIntraday:b.useIntraday!==false,
      strictLow:b.strictLow!==false,
      noNewLow:b.noNewLow===true
    };
    if(c.riseMin>c.riseMax)[c.riseMin,c.riseMax]=[c.riseMax,c.riseMin];
    if(c.zoneMin>c.zoneMax)[c.zoneMin,c.zoneMax]=[c.zoneMax,c.zoneMin];
    if(c.lowPeakMin>c.lowPeakMax)[c.lowPeakMin,c.lowPeakMax]=[c.lowPeakMax,c.lowPeakMin];
    if(c.peakRetestMin>c.peakRetestMax)[c.peakRetestMin,c.peakRetestMax]=[c.peakRetestMax,c.peakRetestMin];
    if(c.zoneDaysMin>c.zoneDaysMax)[c.zoneDaysMin,c.zoneDaysMax]=[c.zoneDaysMax,c.zoneDaysMin];

    const stocks=Array.isArray(b.stocks)?b.stocks.slice(0,25):[];
    const z=await Promise.all(stocks.map(s=>one(s,c)));
    return NextResponse.json({
      ok:true,
      scanned:stocks.length,
      hits:z.filter(x=>x.ok&&x.hit).map(x=>x.hit),
      errors:z.filter(x=>!x.ok),
      sources:z.filter(x=>x.ok).reduce((a,x)=>(a[x.source]=(a[x.source]||0)+1,a),{})
    });
  }catch(e){return NextResponse.json({ok:false,error:String(e?.message||e)},{status:500})}
}
