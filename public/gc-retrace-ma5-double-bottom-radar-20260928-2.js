function localMinimaMa5(bars,start,end){
  const out=[]; start=Math.max(start,2); end=Math.min(end,bars.length-3);
  for(let i=start;i<=end;i++){
    const v=bars[i].ma5; if(!Number.isFinite(v))continue;
    if(v<=bars[i-1].ma5&&v<=bars[i-2].ma5&&v<=bars[i+1].ma5&&v<=bars[i+2].ma5) out.push(i);
  }
  return out;
}
function evaluateGcCandidate(bars,endIdx,gcIdx,c){
  const gc=bars[gcIdx], now=bars[endIdx];
  let peakIdx=gcIdx, peakHigh=gc.high;
  for(let i=gcIdx;i<=endIdx;i++){ if(bars[i].high>peakHigh){peakHigh=bars[i].high;peakIdx=i;} }
  const rise=(peakHigh/gc.close-1)*100; const denom=peakHigh-gc.close; const retr=denom>0?(peakHigh-now.close)/denom*100:NaN;
  const recentStart=Math.max(peakIdx+1,endIdx-c.nearBottomDays); let b2Idx=recentStart;
  for(let i=recentStart;i<=endIdx;i++) if(Number.isFinite(bars[i].ma5)&&(!Number.isFinite(bars[b2Idx].ma5)||bars[i].ma5<bars[b2Idx].ma5))b2Idx=i;
  const mins=localMinimaMa5(bars,peakIdx+1,b2Idx-c.bottomMinGap);
  let bestBottom=null;
  for(const b1Idx of mins){
    const gap=b2Idx-b1Idx; if(gap<c.bottomMinGap||gap>c.bottomMaxGap)continue;
    const b1=bars[b1Idx].ma5,b2=bars[b2Idx].ma5; const similarity=Math.abs(b2/b1-1)*100;
    let valleyMax=-Infinity,valleyIdx=b1Idx;
    for(let i=b1Idx+1;i<b2Idx;i++)if(bars[i].ma5>valleyMax){valleyMax=bars[i].ma5;valleyIdx=i;}
    const valleyRebound=Number.isFinite(valleyMax)?(valleyMax/Math.max(b1,b2)-1)*100:NaN;
    const candidate={b1Idx,b2Idx,valleyIdx,similarity,valleyRebound,gap,b1,b2};
    const rank=(Math.max(0,c.bottomTol-similarity)*4)+(Math.max(0,valleyRebound)*2)-Math.abs(gap-(c.bottomMinGap+c.bottomMaxGap)/2)*.05;
    if(!bestBottom||rank>bestBottom.rank)bestBottom={...candidate,rank};
  }
  const b=bestBottom; const ma5Near=b?Math.abs(now.ma5/b.b2-1)*100:Infinity; const priceMa5Dist=Number.isFinite(now.ma5)?Math.abs(now.close/now.ma5-1)*100:Infinity;
  const turning=endIdx===b2Idx ? (endIdx>0&&now.ma5>=bars[endIdx-1].ma5*.998) : (now.ma5>=bars[b2Idx].ma5);
  const checks={
    gcAge:(endIdx-gcIdx)>=c.gcMinDays&&(endIdx-gcIdx)<=c.gcMaxDays,
    rise:rise>=c.minRise,
    retr:Number.isFinite(retr)&&retr>=c.retrMin&&retr<=c.retrMax,
    hasBottom:!!b,
    bottomSim:!!b&&b.similarity<=c.bottomTol,
    gap:!!b&&b.gap>=c.bottomMinGap&&b.gap<=c.bottomMaxGap,
    valley:!!b&&b.valleyRebound>=c.valleyRise,
    nearBottom:!!b&&(endIdx-b.b2Idx)<=c.nearBottomDays&&ma5Near<=c.ma5NearTol,
    priceNearMa5:priceMa5Dist<=c.priceMa5Tol,
    above20:!c.requireCloseAbove20||now.close>=now.ma20
  };
  const pass=Object.values(checks).every(Boolean);
  let score=0;
  score+=clamp(rise/c.minRise,0,2)*9;
  const retrMid=(c.retrMin+c.retrMax)/2, retrHalf=(c.retrMax-c.retrMin)/2||1; score+=Number.isFinite(retr)?clamp(1-Math.abs(retr-retrMid)/(retrHalf*1.6),0,1)*20:0;
  if(b){ score+=clamp(1-b.similarity/(c.bottomTol*1.5),0,1)*24; score+=clamp(b.valleyRebound/(Math.max(c.valleyRise,1)*2),0,1)*15; score+=clamp(1-(endIdx-b.b2Idx)/(c.nearBottomDays+1),0,1)*12; }
  score+=clamp(1-priceMa5Dist/Math.max(c.priceMa5Tol,1),0,1)*10; if(turning)score+=10;
  return {pass,score:Math.round(score*10)/10,checks,gcIdx,peakIdx,peakHigh,rise,retr,bottom:b,ma5Near,priceMa5Dist,turning,endIdx};
}
function analyzeAt(bars,endIdx,c,diagnostic=false){
  if(endIdx<35||!Number.isFinite(bars[endIdx].ma20))return null;
  const start=Math.max(20,endIdx-c.gcMaxDays-2), latest=endIdx-c.gcMinDays; const candidates=[];
  for(let i=latest;i>=start;i--){
    if(i<=0||!Number.isFinite(bars[i].ma5)||!Number.isFinite(bars[i].ma20)||!Number.isFinite(bars[i-1].ma5)||!Number.isFinite(bars[i-1].ma20))continue;
    if(bars[i-1].ma5<=bars[i-1].ma20&&bars[i].ma5>bars[i].ma20) candidates.push(evaluateGcCandidate(bars,endIdx,i,c));
  }
  if(!candidates.length)return null;
  const passed=candidates.filter(x=>x.pass).sort((a,b)=>b.score-a.score); if(passed.length)return passed[0];
  if(!diagnostic)return null;
  const count=x=>Object.values(x.checks).filter(Boolean).length; candidates.sort((a,b)=>count(b)-count(a)||b.score-a.score); return candidates[0];
}
function futureMetrics(bars,endIdx,forward=20){
  const base=bars[endIdx]?.close; if(!base)return {};
  const r={}; for(const n of [3,5,10,20]){ const j=endIdx+n; r[`r${n}`]=bars[j]?((bars[j].close/base-1)*100):NaN; }
  const end=Math.min(bars.length-1,endIdx+forward); if(end<=endIdx)return {...r,maxUp:NaN,maxDown:NaN,hit5:null,hit10:null,closeForward:NaN};
  let hi=-Infinity,lo=Infinity; for(let i=endIdx+1;i<=end;i++){hi=Math.max(hi,bars[i].high);lo=Math.min(lo,bars[i].low);} r.maxUp=(hi/base-1)*100; r.maxDown=(lo/base-1)*100; r.hit5=r.maxUp>=5; r.hit10=r.maxUp>=10; r.closeForward=(bars[end].close/base-1)*100; return r;
}
function makeResult(stock,bars,a,asOf){ const now=bars[a.endIdx],f=futureMetrics(bars,a.endIdx,20); return {...stock,...a,asOf:now.date,asOfClose:now.close,ma5:now.ma5,ma20:now.ma20,f}; }

function setRunning(v){ running=v; $('scanBtn').disabled=v; $('backtestBtn').disabled=v; $('stopBtn').disabled=!v; }
function startTimer(){ startedAt=Date.now(); clearInterval(timer); timer=setInterval(()=>{const s=Math.floor((Date.now()-startedAt)/1000);$('elapsed').textContent=`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;},500); }
function stopTimer(){ clearInterval(timer);timer=null; }
const updateProgress=debounceFrame((done,total,fail)=>{ $('checkedN').textContent=fmt(done); $('failN').textContent=fmt(fail); $('progressTxt').textContent=`${fmt(done)} / ${fmt(total)}`; $('bar').style.width=`${total?done/total*100:0}%`; $('cacheN').textContent=fmt(historyCache.size); });

async function scanAll(){
  if(running)return; stopRequested=false; const c=getCfg();
