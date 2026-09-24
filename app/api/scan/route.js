import { NextResponse } from 'next/server';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const pct=(a,b)=>b?(a/b-1)*100:0;
function rangeFor(N){ return N<=60?'3mo':(N<=120?'6mo':'1y'); }

function parseChart(j){
  const err=j&&j.chart&&j.chart.error;
  if(err){ const e=new Error(err.description||err.code||'chart error'); e.fatal=true; throw e; }
  const res=j&&j.chart&&j.chart.result&&j.chart.result[0];
  const q=res&&res.indicators&&res.indicators.quote&&res.indicators.quote[0];
  if(!res||!res.timestamp||!q){ const e=new Error('price data missing'); e.fatal=true; throw e; }
  const t=[],h=[],l=[],c=[];
  for(let i=0;i<res.timestamp.length;i++){
    const H=q.high?.[i], L=q.low?.[i], C=q.close?.[i];
    if(!(H>0)||!(L>0)||!(C>0)) continue;
    t.push(res.timestamp[i]); h.push(H); l.push(L); c.push(C);
  }
  return {t,h,l,c};
}

async function yahoo(host,symbol,range){
  const url=`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  const r=await fetch(url,{cache:'no-store',headers:{'User-Agent':UA,Accept:'application/json'}});
  if(!r.ok){ const e=new Error(`${host} ${r.status}`); e.status=r.status; throw e; }
  return parseChart(await r.json());
}

async function history(symbol,N){
  const range=rangeFor(N);
  try{ return {bars:await yahoo('query1',symbol,range),source:'Yahoo query1'}; }
  catch(e1){
    try{ return {bars:await yahoo('query2',symbol,range),source:'Yahoo query2'}; }
    catch(e2){ throw new Error(`${e1.message}; ${e2.message}`); }
  }
}

function detectPattern(bars,N,tol){
  if(N<10) return {candidate:false};
  const total=bars.c.length;
  if(total<10){ const e=new Error('거래일 데이터 부족'); e.fatal=true; throw e; }
  const n=Math.min(N,total);
  const H=bars.h.slice(-n), L=bars.l.slice(-n), C=bars.c.slice(-n);
  const k=Math.max(1,Math.min(8,Math.floor(n/15)));
  const minSwing=Math.max(0.03,tol);
  const minRange=Math.max(0.05,tol*2);

  const piv=[];
  for(let i=k;i<n-k;i++){
    let isL=true,isH=true;
    for(let j=i-k;j<=i+k;j++){
      if(j===i) continue;
      if(L[j]<L[i]) isL=false;
      if(H[j]>H[i]) isH=false;
    }
    if(isL&&!isH) piv.push({i,type:'L',v:L[i]});
    else if(isH&&!isL) piv.push({i,type:'H',v:H[i]});
  }

  const zz=[];
  for(const p of piv){
    const last=zz[zz.length-1];
    if(!last){ zz.push(p); continue; }
    if(last.type===p.type){
      if(p.type==='L'?p.v<last.v:p.v>last.v) zz[zz.length-1]=p;
    }else{
      const swing=p.type==='H'?p.v/last.v-1:last.v/p.v-1;
      if(swing>=minSwing) zz.push(p);
    }
  }
  const lows=zz.filter(p=>p.type==='L'), highs=zz.filter(p=>p.type==='H');
  if(!lows.length||!highs.length) return {candidate:false};

  const price=C[n-1];
  let bestL=null;
  for(const a of lows){
    const mem=lows.filter(b=>b.v>=a.v&&b.v<=a.v*(1+tol));
    const level=mem.reduce((s,b)=>s+b.v,0)/mem.length;
    const dist=price/level-1;
    if(Math.abs(dist)>tol) continue;
    const lastIdx=Math.max(...mem.map(b=>b.i));
    const sameEpisode=(n-1-lastIdx)<=2*k;
    const touches=mem.length+(sameEpisode?0:1);
    if(touches<2) continue;
    const spread=Math.max(...mem.map(b=>b.v))/a.v-1;
    const cand={mem,level,dist,touches,spread};
    if(!bestL||cand.touches>bestL.touches||(cand.touches===bestL.touches&&Math.abs(cand.dist)<Math.abs(bestL.dist))) bestL=cand;
  }
  if(!bestL) return {candidate:false};

  const hs=highs.filter(p=>p.v>=bestL.level*(1+minRange));
  if(!hs.length) return {candidate:false};
  let bestH=null;
  for(const a of hs){
    const mem=hs.filter(b=>b.v<=a.v&&b.v>=a.v/(1+tol));
    const level=mem.reduce((s,b)=>s+b.v,0)/mem.length;
    const spread=mem.length>1?Math.max(...mem.map(b=>b.v))/Math.min(...mem.map(b=>b.v))-1:0;
    if(!bestH||mem.length>bestH.mem.length||(mem.length===bestH.mem.length&&level>bestH.level)) bestH={mem,level,spread};
  }

  const lowSet=new Set(bestL.mem), highSet=new Set(bestH.mem);
  let state=null,cycles=0;
  for(const p of zz){
    if(p.type==='L'&&lowSet.has(p)){ if(state==='H') cycles++; state='L'; }
    else if(p.type==='H'&&highSet.has(p)){ if(state==='L') state='H'; }
  }
  if(state==='H') cycles++;
  if(cycles<1) return {candidate:false};

  const range=bestH.level/bestL.level-1;
  const p=bestL.dist/tol;
  const sProx=30*Math.max(0,p>=0?1-p:1-1.5*(-p));
  const sCyc=25*Math.min(cycles,4)/4;
  const sLow=10*Math.min(bestL.touches,4)/4+5*Math.max(0,1-bestL.spread/tol);
  const sHigh=10*Math.min(bestH.mem.length,3)/3;
  const sAmp=20*Math.min(1,range/0.25);
  const score=clamp(Math.round(sProx+sCyc+sLow+sHigh+sAmp),0,100);
  return {candidate:true,price,lowLevel:bestL.level,highLevel:bestH.level,lowTouches:bestL.touches,highTouches:bestH.mem.length,lowSpread:bestL.spread*100,highSpread:bestH.spread*100,dist:bestL.dist*100,range:range*100,cycles,score,spark:C.slice(-60)};
}

async function one(s,days,proximity){
  try{
    const h=await history(s.yahoo||s.code,days);
    const r=detectPattern(h.bars,days,proximity/100);
    if(!r.candidate) return {ok:true,source:h.source,hit:null};
    const c=h.bars.c, current=r.price;
    const ret5=c.length>5?pct(current,c[c.length-6]):0;
    const hit={
      ...s,
      current,
      support:r.lowLevel,
      resistance:r.highLevel,
      distance:r.dist,
      rangePos:(current-r.lowLevel)/(r.highLevel-r.lowLevel)*100,
      amplitude:r.range,
      lowDisp:r.lowSpread,
      highDisp:r.highSpread,
      cycles:r.cycles,
      pivotLows:r.lowTouches,
      pivotHighs:r.highTouches,
      score:r.score,
      ret5,
      reason:`반복저점 ${r.lowTouches}회 · 반복고점 ${r.highTouches}회 · 사이클 ${r.cycles}회 · 저점거리 ${r.dist>=0?'+':''}${r.dist.toFixed(1)}% · 변동폭 ${r.range.toFixed(1)}%`,
      spark:r.spark.map((v,i)=>[i,v]),
      source:h.source
    };
    return {ok:true,source:h.source,hit};
  }catch(e){ return {ok:false,code:s.code,name:s.name,error:String(e?.message||e)}; }
}

export async function POST(req){
  try{
    const b=await req.json();
    const days=clamp(Number(b.days||120),1,240);
    const proximity=clamp(Number(b.proximity||5),1,20);
    const stocks=Array.isArray(b.stocks)?b.stocks.slice(0,20):[];
    const z=await Promise.all(stocks.map(s=>one(s,days,proximity)));
    return NextResponse.json({ok:true,scanned:stocks.length,hits:z.filter(x=>x.ok&&x.hit).map(x=>x.hit),errors:z.filter(x=>!x.ok),sources:z.filter(x=>x.ok).reduce((a,x)=>(a[x.source]=(a[x.source]||0)+1,a),{})});
  }catch(e){
    return NextResponse.json({ok:false,error:String(e?.message||e)},{status:500});
  }
}
