const $ = id => document.getElementById(id);
const LOCK = '19e5afe03ed07447185162e747fcabc8128d5d6c0caa2ece63ec3f0382d109fc';
const DEVICE_KEY = 'gc_retrace_ma5_first_bottom_device_v1';
let masterCache = null;
let universe = [];
let historyCache = new Map();
let results = [];
let backtestRows = [];
let running = false;
let stopRequested = false;
let startedAt = 0;
let timer = null;

const fmt = n => Number.isFinite(Number(n)) ? Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '-';
const pctText = n => Number.isFinite(Number(n)) ? `${Number(n) >= 0 ? '+' : ''}${Number(n).toFixed(2)}%` : '-';
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const clamp = (x,a,b) => Math.max(a, Math.min(b,x));
const avg = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : NaN;
const sleep = ms => new Promise(r=>setTimeout(r,ms));

function toYmd(v){ return String(v||'').replace(/-/g,'').slice(0,8); }
function isoFromYmd(v){ const s=String(v||''); return s.length===8?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`:s; }
function localIsoDate(d=new Date()){ const z=new Date(d.getTime()-d.getTimezoneOffset()*60000); return z.toISOString().slice(0,10); }
function daysAgo(n){ const d=new Date(); d.setDate(d.getDate()-n); return localIsoDate(d); }
function debounceFrame(fn){ let q=false; return (...args)=>{ if(q)return; q=true; requestAnimationFrame(()=>{q=false;fn(...args);});}; }

async function sha256(text){ const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)); return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
function showLogin(){ $('login').classList.remove('hide'); $('app').classList.add('hide'); setTimeout(()=>$('code').focus(),50); }
function showApp(){ $('login').classList.add('hide'); $('app').classList.remove('hide'); }
async function login(){
  try{
    $('loginErr').textContent='확인 중...';
    const h=await sha256($('code').value.trim());
    if(h!==LOCK) throw new Error('인증번호가 맞지 않습니다.');
    localStorage.setItem(DEVICE_KEY,LOCK);
    $('loginErr').textContent=''; showApp(); await loadUniverse();
  }catch(e){ $('loginErr').textContent=e.message||String(e); }
}
$('loginBtn').addEventListener('click',login);
$('code').addEventListener('keydown',e=>{if(e.key==='Enter')login();});
$('logoutBtn').addEventListener('click',()=>{localStorage.removeItem(DEVICE_KEY);showLogin();});

async function fetchWithRetry(url, options={}, tries=2){
  let last;
  for(let i=0;i<=tries;i++){
    try{
      const r=await fetch(url,{cache:'no-store',...options});
      if(r.ok)return r;
      last=new Error(`HTTP ${r.status}`);
      if(![408,429,500,502,503,504].includes(r.status))throw last;
    }catch(e){ last=e; }
    if(i<tries)await sleep(250+Math.random()*350+i*450);
  }
  throw last||new Error('데이터 요청 실패');
}

async function loadMaster(market){
  if(typeof JSZip==='undefined') throw new Error('종목 마스터 압축 해제 모듈을 불러오지 못했습니다.');
  const tail=market==='KOSPI'?228:222;
  const url=market==='KOSPI'?'/data/master/kospi':'/data/master/kosdaq';
  const filename=market==='KOSPI'?'kospi_code.mst':'kosdaq_code.mst';
  const r=await fetchWithRetry(url,{},2);
  const ab=await r.arrayBuffer();
  const zip=await JSZip.loadAsync(ab);
  const file=zip.file(filename);
  if(!file) throw new Error(`${market} 마스터 파일 누락`);
  const bytes=await file.async('uint8array');
  const text=new TextDecoder('euc-kr').decode(bytes);
  const rows=[];
  for(const row of text.split(/\r?\n/)){
    if(!row)continue;
    const part1=row.slice(0,row.length-tail);
    const code=part1.slice(0,9).trim();
    if(!/^\d{6}$/.test(code))continue;
    const name=part1.slice(21).trim();
    const group=row.slice(-tail).slice(0,2).trim();
    if(market==='KOSPI'&&(group==='E'||group===')E'))continue;
    rows.push({code,name,market,group});
  }
  return rows;
}

async function getMasterUniverse(){
  if(masterCache)return masterCache;
  $('status').textContent='코스피·코스닥 전종목 목록 불러오는 중...';
  const [a,b]=await Promise.all([loadMaster('KOSPI'),loadMaster('KOSDAQ')]);
  masterCache=[...a,...b];
  return masterCache;
}

async function loadUniverse(){
  const all=[...await getMasterUniverse()];
  const market=$('market').value;
  let rows=market==='BOTH'?all:all.filter(x=>x.market===market);
  if($('excludeSpac').checked)rows=rows.filter(x=>!/(스팩|SPAC)/i.test(x.name));
  universe=rows;
  $('universeN').textContent=fmt(rows.length);
  $('cacheN').textContent=fmt([...historyCache.keys()].filter(c=>rows.some(x=>x.code===c)).length);
  const k1=rows.filter(x=>x.market==='KOSPI').length,k2=rows.filter(x=>x.market==='KOSDAQ').length;
  $('status').textContent=`목록 준비 · KOSPI ${fmt(k1)} / KOSDAQ ${fmt(k2)}`;
  $('progressTxt').textContent=`0 / ${fmt(rows.length)}`;
  return rows;
}
$('market').addEventListener('change',()=>{if(!running)loadUniverse();});
$('excludeSpac').addEventListener('change',()=>{if(!running)loadUniverse();});

function parseFchart(xml){
  const out=[];
  const re=/<item\s+data="([^"]+)"\s*\/?>/g;
  let m;
  while((m=re.exec(xml))){
    const p=m[1].split('|');
    if(p.length<6)continue;
    const [date,open,high,low,close,volume]=p;
    const nums=[open,high,low,close,volume].map(Number);
    if(!date||nums.some(v=>!Number.isFinite(v)))continue;
    out.push({date,open:nums[0],high:nums[1],low:nums[2],close:nums[3],volume:nums[4]});
  }
  out.sort((a,b)=>a.date.localeCompare(b.date));
  return enhanceBars(out);
}

function enhanceBars(bars){
  let s5=0,s20=0;
  for(let i=0;i<bars.length;i++){
    s5+=bars[i].close; s20+=bars[i].close;
    if(i>=5)s5-=bars[i-5].close;
    if(i>=20)s20-=bars[i-20].close;
    bars[i].ma5=i>=4?s5/5:NaN;
    bars[i].ma20=i>=19?s20/20:NaN;
  }
  return bars;
}

async function getHistory(stock){
  if(historyCache.has(stock.code))return historyCache.get(stock.code);
  const r=await fetchWithRetry(`/data/chart/${stock.code}`,{},2);
  const bars=parseFchart(await r.text());
  if(bars.length<60)throw new Error(`가격 이력 부족(${bars.length})`);
  historyCache.set(stock.code,bars);
  return bars;
}

function endIndexForDate(bars,asOf){
  const y=toYmd(asOf); let lo=0,hi=bars.length-1,ans=-1;
  while(lo<=hi){ const mid=(lo+hi)>>1; if(bars[mid].date<=y){ans=mid;lo=mid+1}else hi=mid-1; }
  return ans;
}

function getCfg(){
  return {
    stageMode:$('stageMode').value,
    gcMinDays:+$('gcMinDays').value,
    gcMaxDays:+$('gcMaxDays').value,
    minRise:+$('minRise').value,
    peakMinAge:+$('peakMinAge').value,
    peakMaxAge:+$('peakMaxAge').value,
    retrMin:+$('retrMin').value,
    retrMax:+$('retrMax').value,
    bottomRecentDays:+$('bottomRecentDays').value,
    ma5DownDays:+$('ma5DownDays').value,
    priceBottomTol:+$('priceBottomTol').value,
    ma5BottomTol:+$('ma5BottomTol').value,
    turnMinPct:+$('turnMinPct').value,
    priorBounceReject:+$('priorBounceReject').value,
    requireCloseAbove20:$('requireCloseAbove20').checked,
    requirePeakAfterGc:$('requirePeakAfterGc').checked
  };
}
function validateCfg(c){
  if(c.gcMinDays>=c.gcMaxDays)throw new Error('골든크로스 최소 경과일은 최대 경과일보다 작아야 합니다.');
  if(c.peakMinAge>c.peakMaxAge)throw new Error('고점 후 최소 경과일은 최대 경과일보다 작거나 같아야 합니다.');
  if(c.retrMin>=c.retrMax)throw new Error('조정비율 하단은 상단보다 작아야 합니다.');
}

function ma5DownCountInto(bars,idx,limitStart){
  let n=0;
  for(let i=idx;i>limitStart;i--){
    const a=bars[i]?.ma5,b=bars[i-1]?.ma5;
    if(!Number.isFinite(a)||!Number.isFinite(b))break;
    if(a<=b*1.001){n++;}else break;
  }
  return n;
}

function localMinimaMa5(bars,start,end){
  const out=[];
  start=Math.max(start,2); end=Math.min(end,bars.length-3);
  for(let i=start;i<=end;i++){
    const v=bars[i].ma5;
    if(!Number.isFinite(v))continue;
    if(v<=bars[i-1].ma5&&v<=bars[i-2].ma5&&v<=bars[i+1].ma5&&v<=bars[i+2].ma5)out.push(i);
  }
  return out;
}

function findPriorStrongBottom(bars,peakIdx,bottomIdx,reboundPct){
  if(bottomIdx-peakIdx<5)return null;
  const mins=localMinimaMa5(bars,peakIdx+1,bottomIdx-2);
  for(const idx of mins){
    let hi=-Infinity,hiIdx=-1;
    for(let i=idx+1;i<bottomIdx;i++){
      const v=bars[i].ma5;
      if(Number.isFinite(v)&&v>hi){hi=v;hiIdx=i;}
    }
    const base=bars[idx].ma5;
    const rebound=Number.isFinite(hi)&&Number.isFinite(base)&&base>0?(hi/base-1)*100:NaN;
    if(Number.isFinite(rebound)&&rebound>=reboundPct)return {idx,hiIdx,rebound};
  }
  return null;
}

function evaluateFirstBottomCandidate(bars,endIdx,gcIdx,c){
  const gc=bars[gcIdx],now=bars[endIdx];
  let peakIdx=gcIdx,peakHigh=gc.high;
  for(let i=gcIdx;i<=endIdx;i++)if(bars[i].high>peakHigh){peakHigh=bars[i].high;peakIdx=i;}
  const rise=(peakHigh/gc.close-1)*100;
  const denom=peakHigh-gc.close;
  const retr=denom>0?(peakHigh-now.close)/denom*100:NaN;
  const gcAge=endIdx-gcIdx;
  const peakAge=endIdx-peakIdx;

  let bottomIdx=-1,bottomMa5=Infinity;
  for(let i=peakIdx+1;i<=endIdx;i++){
    const v=bars[i].ma5;
    if(Number.isFinite(v)&&v<bottomMa5){bottomMa5=v;bottomIdx=i;}
  }
  if(bottomIdx<0)bottomMa5=NaN;
  const bottomAge=bottomIdx>=0?endIdx-bottomIdx:Infinity;
  const priceBottomDist=Number.isFinite(bottomMa5)?Math.abs(now.close/bottomMa5-1)*100:Infinity;
  const ma5BottomDist=Number.isFinite(bottomMa5)&&Number.isFinite(now.ma5)?Math.abs(now.ma5/bottomMa5-1)*100:Infinity;
  const turnPct=Number.isFinite(bottomMa5)&&Number.isFinite(now.ma5)?(now.ma5/bottomMa5-1)*100:NaN;
  const downCount=bottomIdx>=0?ma5DownCountInto(bars,bottomIdx,peakIdx):0;
  const priorBottom=bottomIdx>=0?findPriorStrongBottom(bars,peakIdx,bottomIdx,c.priorBounceReject):null;

  const early=bottomIdx>=0&&bottomAge<=c.bottomRecentDays&&(bottomAge===0||!Number.isFinite(turnPct)||turnPct<c.turnMinPct);
  const confirmed=bottomIdx>=0&&bottomAge>=1&&bottomAge<=c.bottomRecentDays&&Number.isFinite(turnPct)&&turnPct>=c.turnMinPct;
  const stage=confirmed?'CONFIRMED':(early?'EARLY':'NONE');
  const stagePass=c.stageMode==='BOTH'?(early||confirmed):((c.stageMode==='EARLY'&&early)||(c.stageMode==='CONFIRMED'&&confirmed));

  const checks={
    gcAge:gcAge>=c.gcMinDays&&gcAge<=c.gcMaxDays,
    peakAfterGc:!c.requirePeakAfterGc||(peakIdx-gcIdx)>=2,
    rise:rise>=c.minRise,
    peakAge:peakAge>=c.peakMinAge&&peakAge<=c.peakMaxAge,
    retr:Number.isFinite(retr)&&retr>=c.retrMin&&retr<=c.retrMax,
    hasBottom:bottomIdx>=0,
    bottomRecent:bottomIdx>=0&&bottomAge<=c.bottomRecentDays,
    ma5Down:downCount>=c.ma5DownDays,
    firstBottom:!priorBottom,
    priceNearBottom:priceBottomDist<=c.priceBottomTol,
    ma5NearBottom:ma5BottomDist<=c.ma5BottomTol,
    stage:stagePass,
    above20:!c.requireCloseAbove20||now.close>=now.ma20
  };
  const pass=Object.values(checks).every(Boolean);

  let score=0;
  score+=clamp(rise/Math.max(c.minRise,1),0,2)*10;
  const mid=(c.retrMin+c.retrMax)/2,half=(c.retrMax-c.retrMin)/2||1;
  score+=Number.isFinite(retr)?clamp(1-Math.abs(retr-mid)/(half*1.5),0,1)*20:0;
  score+=bottomIdx>=0?clamp(1-bottomAge/(c.bottomRecentDays+1),0,1)*18:0;
  score+=clamp(downCount/Math.max(c.ma5DownDays,1),0,2)*8;
  score+=clamp(1-priceBottomDist/Math.max(c.priceBottomTol,1),0,1)*14;
  score+=clamp(1-ma5BottomDist/Math.max(c.ma5BottomTol,0.25),0,1)*12;
  score+=priorBottom?0:10;
  score+=confirmed?12:(early?7:0);

  return {
    pass,score:Math.round(score*10)/10,checks,gcIdx,peakIdx,peakHigh,rise,retr,gcAge,peakAge,
    bottomIdx,bottomMa5,bottomAge,priceBottomDist,ma5BottomDist,turnPct,downCount,priorBottom,stage,early,confirmed,endIdx
  };
}

function analyzeAt(bars,endIdx,c,diagnostic=false){
  if(endIdx<35||!Number.isFinite(bars[endIdx].ma20))return null;
  const start=Math.max(20,endIdx-c.gcMaxDays-2),latest=endIdx-c.gcMinDays;
  const candidates=[];
  for(let i=latest;i>=start;i--){
    if(i<=0||!Number.isFinite(bars[i].ma5)||!Number.isFinite(bars[i].ma20)||!Number.isFinite(bars[i-1].ma5)||!Number.isFinite(bars[i-1].ma20))continue;
    if(bars[i-1].ma5<=bars[i-1].ma20&&bars[i].ma5>bars[i].ma20)candidates.push(evaluateFirstBottomCandidate(bars,endIdx,i,c));
  }
  if(!candidates.length)return null;
  const passed=candidates.filter(x=>x.pass).sort((a,b)=>b.score-a.score);
  if(passed.length)return passed[0];
  if(!diagnostic)return null;
  const count=x=>Object.values(x.checks).filter(Boolean).length;
  candidates.sort((a,b)=>count(b)-count(a)||b.score-a.score);
  return candidates[0];
}

function futureMetrics(bars,endIdx,forward=20){
  const base=bars[endIdx]?.close;if(!base)return {};
  const r={};
  for(const n of [3,5,10,20]){const j=endIdx+n;r[`r${n}`]=bars[j]?((bars[j].close/base-1)*100):NaN;}
  const end=Math.min(bars.length-1,endIdx+forward);
  if(end<=endIdx)return {...r,maxUp:NaN,maxDown:NaN,hit5:null,hit10:null,closeForward:NaN};
  let hi=-Infinity,lo=Infinity;
  for(let i=endIdx+1;i<=end;i++){hi=Math.max(hi,bars[i].high);lo=Math.min(lo,bars[i].low);}
  r.maxUp=(hi/base-1)*100;r.maxDown=(lo/base-1)*100;r.hit5=r.maxUp>=5;r.hit10=r.maxUp>=10;r.closeForward=(bars[end].close/base-1)*100;
  return r;
}
function makeResult(stock,bars,a){const now=bars[a.endIdx],f=futureMetrics(bars,a.endIdx,20);return {...stock,...a,asOf:now.date,asOfClose:now.close,ma5:now.ma5,ma20:now.ma20,f};}

function setRunning(v){running=v;$('scanBtn').disabled=v;$('backtestBtn').disabled=v;$('stopBtn').disabled=!v;}
function startTimer(){startedAt=Date.now();clearInterval(timer);timer=setInterval(()=>{const s=Math.floor((Date.now()-startedAt)/1000);$('elapsed').textContent=`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;},500);}
function stopTimer(){clearInterval(timer);timer=null;}
const updateProgress=debounceFrame((done,total,fail)=>{$('checkedN').textContent=fmt(done);$('failN').textContent=fmt(fail);$('progressTxt').textContent=`${fmt(done)} / ${fmt(total)}`;$('bar').style.width=`${total?done/total*100:0}%`;$('cacheN').textContent=fmt(historyCache.size);});

async function scanAll(){
  if(running)return;
  stopRequested=false;
  const c=getCfg();
  try{
    validateCfg(c);
    const asOf=toYmd($('asOf').value);
    if(!/^\d{8}$/.test(asOf))throw new Error('기준일을 선택하세요.');
    const rows=await loadUniverse();
    results=[];renderResults();setRunning(true);startTimer();
    let cursor=0,done=0,fail=0;
    $('status').textContent=`${isoFromYmd(asOf)} 기준 MA5 1저점 검색 중...`;$('matchN').textContent='0';
    const worker=async()=>{
      while(true){
        if(stopRequested)return;
        const idx=cursor++;if(idx>=rows.length)return;
        const stock=rows[idx];
        try{
          const bars=await getHistory(stock);
          const endIdx=endIndexForDate(bars,asOf);
          if(endIdx>=0){const a=analyzeAt(bars,endIdx,c,false);if(a){results.push(makeResult(stock,bars,a));$('matchN').textContent=fmt(results.length);}}
        }catch(e){fail++;}
        done++;if(done%5===0||done===rows.length)updateProgress(done,rows.length,fail);
      }
    };
    const n=clamp(+$('concurrency').value||10,1,24);
    await Promise.all(Array.from({length:n},worker));
    results.sort((a,b)=>b.score-a.score);
    renderResults();
    $('status').textContent=stopRequested?`중지됨 · ${fmt(done)}개 검사`:`완료 · ${fmt(rows.length)}개 중 ${fmt(results.length)}개 검출`;
    $('excelBtn').disabled=!results.length;
  }catch(e){$('status').textContent=`오류: ${e.message||e}`;}
  finally{setRunning(false);stopTimer();}
}
$('scanBtn').addEventListener('click',scanAll);
$('stopBtn').addEventListener('click',()=>{stopRequested=true;$('status').textContent='중지 요청...';});

function stageText(r){return r.stage==='CONFIRMED'?'반등확인형':(r.stage==='EARLY'?'진행형':'미확정');}
function stageBadge(r){return r.stage==='CONFIRMED'?'good':'warn';}
function barsDate(code,idx){return Number.isInteger(idx)?(historyCache.get(code)?.[idx]?.date||''):'';}

function renderResults(){
  const tb=$('tbody');
  if(!results.length){
    tb.innerHTML='<tr><td colspan="15" class="empty">조건에 맞는 종목이 아직 없습니다.</td></tr>';
    $('resultMeta').textContent='검색 결과 0개';updateValidationSummary();return;
  }
  tb.innerHTML=results.map((r,i)=>`<tr>
    <td>${i+1}</td><td><b>${r.score.toFixed(1)}</b></td>
    <td><span class="badge ${stageBadge(r)}">${stageText(r)}</span></td>
    <td><b>${esc(r.name)}</b><br><span class="muted">${r.market} · ${r.code}</span></td>
    <td><b>${fmt(r.asOfClose)}</b><br><span class="muted">${isoFromYmd(r.asOf)}</span></td>
    <td>${isoFromYmd(barsDate(r.code,r.gcIdx))}<br><span class="muted">${r.gcAge}거래일 전</span></td>
    <td>${isoFromYmd(barsDate(r.code,r.peakIdx))}<br><span class="muted">${fmt(r.peakHigh)}</span></td>
    <td>${pctText(r.rise)}</td>
    <td><span class="badge ${r.retr>=40&&r.retr<=85?'good':'warn'}">${r.retr.toFixed(1)}%</span></td>
    <td>${isoFromYmd(barsDate(r.code,r.bottomIdx))}<br><span class="muted">MA5 ${fmt(r.bottomMa5)}</span></td>
    <td>저점 +${r.bottomAge}일<br><span class="muted">가격거리 ${r.priceBottomDist.toFixed(2)}% · MA5 ${r.ma5BottomDist.toFixed(2)}%</span></td>
    <td>${pctText(r.f.r3)} / ${pctText(r.f.r5)}<br>${pctText(r.f.r10)} / ${pctText(r.f.r20)}</td>
    <td><span class="${r.f.maxUp>=5?'pass':''}">${pctText(r.f.maxUp)}</span><br><span class="${r.f.maxDown<=-5?'fail':''}">${pctText(r.f.maxDown)}</span></td>
    <td><a target="_blank" rel="noopener" href="https://finance.naver.com/item/main.naver?code=${r.code}">네이버증권</a></td>
    <td><button class="btn secondary detailBtn" data-code="${r.code}">차트/근거</button></td>
  </tr>`).join('');
  $('resultMeta').textContent=`${isoFromYmd(results[0].asOf)} 기준 · ${fmt(results.length)}개 · 점수순`;
  updateValidationSummary();
  document.querySelectorAll('.detailBtn').forEach(b=>b.addEventListener('click',()=>openDetail(b.dataset.code)));
}

function updateValidationSummary(){
  $('vCount').textContent=results.length||'-';
  $('vEarly').textContent=results.length?results.filter(r=>r.stage==='EARLY').length:'-';
  $('vConfirmed').textContent=results.length?results.filter(r=>r.stage==='CONFIRMED').length:'-';
  const mean=k=>{const a=results.map(r=>r.f[k]).filter(Number.isFinite);return a.length?avg(a):NaN;};
  $('vR5').textContent=pctText(mean('r5'));
  const h10=results.filter(r=>r.f.hit10!==null);
  $('vHit10').textContent=h10.length?`${(h10.filter(r=>r.f.hit10).length/h10.length*100).toFixed(1)}%`:'-';
  $('vMdd').textContent=pctText(mean('maxDown'));
}

function checkLabel(k){return ({
  gcAge:'골든크로스 경과일',peakAfterGc:'고점이 GC 뒤 형성',rise:'교차 후 최소 상승',peakAge:'고점 후 경과일',retr:'조정비율 범위',
  hasBottom:'고점 뒤 MA5 저점 존재',bottomRecent:'1저점 최근성',ma5Down:'MA5 하락 연속일',firstBottom:'이전 강한 1저점 없음',priceNearBottom:'현재가가 1저점 근처',
  ma5NearBottom:'현재 MA5가 1저점 근처',stage:'선택한 신호 단계',above20:'MA20 조건'
}[k]||k);}

function detailHtml(r){
  const checks=Object.entries(r.checks).map(([k,v])=>`<div><small>${esc(checkLabel(k))}</small><b class="${v?'pass':'fail'}">${v?'통과':'미통과'}</b></div>`).join('');
  const prior=r.priorBottom?`${isoFromYmd(barsDate(r.code,r.priorBottom.idx))} 이후 ${r.priorBottom.rebound.toFixed(2)}% 반등`:'없음';
  return `<div class="detail-grid">
    <div><small>신호 단계</small><b>${stageText(r)}</b></div>
    <div><small>골든크로스</small><b>${isoFromYmd(barsDate(r.code,r.gcIdx))}</b></div>
    <div><small>교차 종가</small><b>${fmt(historyCache.get(r.code)[r.gcIdx].close)}</b></div>
    <div><small>급등 고점</small><b>${fmt(r.peakHigh)} · ${isoFromYmd(barsDate(r.code,r.peakIdx))}</b></div>
    <div><small>교차→고점</small><b>${pctText(r.rise)}</b></div>
    <div><small>현재 조정비율</small><b>${r.retr.toFixed(2)}%</b></div>
    <div><small>MA5 1저점</small><b>${fmt(r.bottomMa5)} · ${isoFromYmd(barsDate(r.code,r.bottomIdx))}</b></div>
    <div><small>현재 MA5</small><b>${fmt(r.ma5)} · 저점대비 ${pctText(r.turnPct)}</b></div>
    <div><small>MA5 하락 연속</small><b>${r.downCount}일</b></div>
    <div><small>현재가/1저점 거리</small><b>${r.priceBottomDist.toFixed(2)}%</b></div>
    <div><small>현재 MA5/1저점 거리</small><b>${r.ma5BottomDist.toFixed(2)}%</b></div>
    <div><small>이전 강한 저점</small><b>${prior}</b></div>
  </div><h3>조건 판정</h3><div class="detail-grid">${checks}</div>
  <p><a target="_blank" rel="noopener" href="https://finance.naver.com/item/main.naver?code=${r.code}">네이버증권에서 ${esc(r.name)} 열기</a></p>`;
}

function openDetail(code){
  const r=results.find(x=>x.code===code);if(!r)return;
  $('modalTitle').textContent=`${r.name} (${r.code}) · ${isoFromYmd(r.asOf)} · ${stageText(r)}`;
  $('modalBody').innerHTML=detailHtml(r);
  $('modal').classList.remove('hide');drawChart(r);
}
$('modalClose').addEventListener('click',()=>$('modal').classList.add('hide'));
$('modal').addEventListener('click',e=>{if(e.target===$('modal'))$('modal').classList.add('hide');});

function drawChart(r){
  const canvas=$('chart'),ctx=canvas.getContext('2d'),bars=historyCache.get(r.code);if(!ctx||!bars)return;
  const end=r.endIdx,start=Math.max(20,end-110),view=bars.slice(start,end+1),W=canvas.width,H=canvas.height,pad={l:56,r:22,t:28,b:34};
  ctx.clearRect(0,0,W,H);ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
  const vals=[];view.forEach(x=>{vals.push(x.close);if(Number.isFinite(x.ma5))vals.push(x.ma5);if(Number.isFinite(x.ma20))vals.push(x.ma20);});
  let lo=Math.min(...vals),hi=Math.max(...vals);const m=(hi-lo)*.08||1;lo-=m;hi+=m;
  const x=i=>pad.l+(i/(view.length-1||1))*(W-pad.l-pad.r),y=v=>pad.t+(hi-v)/(hi-lo)*(H-pad.t-pad.b);
  ctx.strokeStyle='#e5e7eb';ctx.lineWidth=1;ctx.fillStyle='#64748b';ctx.font='12px sans-serif';
  for(let k=0;k<=4;k++){const yy=pad.t+k*(H-pad.t-pad.b)/4;ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(W-pad.r,yy);ctx.stroke();const v=hi-k*(hi-lo)/4;ctx.fillText(Math.round(v).toLocaleString(),4,yy+4);}
  const line=(key,color,w)=>{ctx.strokeStyle=color;ctx.lineWidth=w;ctx.beginPath();let begun=false;view.forEach((b,i)=>{const v=b[key];if(!Number.isFinite(v))return;const xx=x(i),yy=y(v);if(!begun){ctx.moveTo(xx,yy);begun=true;}else ctx.lineTo(xx,yy);});ctx.stroke();};
  line('close','#334155',2);line('ma5','#2563eb',3);line('ma20','#f59e0b',2.5);
  const marks=[['GC',r.gcIdx,'#16a34a'],['고점',r.peakIdx,'#dc2626'],['1저점',r.bottomIdx,'#7c3aed']];
  marks.forEach(([label,idx,color])=>{if(!Number.isInteger(idx)||idx<start||idx>end)return;const xx=x(idx-start);ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(xx,pad.t);ctx.lineTo(xx,H-pad.b);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=color;ctx.fillText(label,Math.min(xx+4,W-60),pad.t+14);});
  ctx.fillStyle='#0f172a';ctx.font='bold 14px sans-serif';ctx.fillText('종가(회색) · MA5(파랑) · MA20(주황)',pad.l,pad.t-8);
}

async function verifyOne(){
  try{
    const code=$('verifyCode').value.trim();if(!/^\d{6}$/.test(code))throw new Error('6자리 종목코드를 입력하세요.');
    const all=await getMasterUniverse();const stock=all.find(x=>x.code===code)||{code,name:code,market:'-'};
    $('verifyMsg').textContent='가격 불러오는 중...';
    const bars=await getHistory(stock),endIdx=endIndexForDate(bars,$('asOf').value);
    if(endIdx<35)throw new Error('해당 기준일의 가격 이력이 부족합니다.');
    const c=getCfg();validateCfg(c);const a=analyzeAt(bars,endIdx,c,true);
    if(!a){$('verifyBox').innerHTML='<b class="fail">골든크로스 후보 자체가 없습니다.</b>';$('verifyMsg').textContent='';return;}
    const r=makeResult(stock,bars,a);
    const cells=Object.entries(a.checks).map(([k,v])=>`<div><small>${esc(checkLabel(k))}</small><br><b class="${v?'pass':'fail'}">${v?'통과':'미통과'}</b></div>`).join('');
    $('verifyBox').innerHTML=`<b>${esc(stock.name)} (${code}) · ${isoFromYmd(r.asOf)} 종가 ${fmt(r.asOfClose)} · ${stageText(r)}</b><div class="verify-grid">${cells}</div><p>GC ${isoFromYmd(barsDate(code,a.gcIdx))} · 고점 ${fmt(a.peakHigh)} (${pctText(a.rise)}) · 조정 ${Number.isFinite(a.retr)?a.retr.toFixed(2)+'%':'-'} · 1저점 MA5 ${fmt(a.bottomMa5)} (${isoFromYmd(barsDate(code,a.bottomIdx))}) · MA5 하락 ${a.downCount}일 · 현재가/저점 거리 ${a.priceBottomDist.toFixed(2)}%</p>`;
    $('verifyMsg').textContent=a.pass?'현재 설정으로 검출됩니다.':'현재 설정에서는 일부 조건이 미통과입니다.';
  }catch(e){$('verifyMsg').textContent=e.message||String(e);}
}
$('verifyBtn').addEventListener('click',verifyOne);

async function ensureAllHistories(rows){
  const missing=rows.filter(s=>!historyCache.has(s.code));if(!missing.length)return;
  let cursor=0,done=0,fail=0;const total=missing.length;
  $('status').textContent=`백테스트용 가격 적재 중 · 캐시 ${fmt(historyCache.size)}개`;
  const worker=async()=>{while(true){if(stopRequested)return;const i=cursor++;if(i>=total)return;try{await getHistory(missing[i]);}catch(e){fail++;}done++;if(done%5===0||done===total)updateProgress(done,total,fail);}};
  const n=clamp(+$('concurrency').value||10,1,24);await Promise.all(Array.from({length:n},worker));
}
function referenceDates(rows,start,end){let best=[];for(const s of rows){const b=historyCache.get(s.code);if(b&&b.length>best.length)best=b;}const a=toYmd(start),z=toYmd(end);return best.filter(x=>x.date>=a&&x.date<=z).map(x=>x.date);}
function summaryForSignals(signals,forward){
  if(!signals.length)return {n:0,close:NaN,maxUp:NaN,hit5:NaN,hit10:NaN,down:NaN};
  const mets=signals.map(r=>futureMetrics(historyCache.get(r.code),r.endIdx,forward)).filter(x=>Number.isFinite(x.maxUp));
  if(!mets.length)return {n:signals.length,close:NaN,maxUp:NaN,hit5:NaN,hit10:NaN,down:NaN};
  return {n:signals.length,close:avg(mets.map(x=>x.closeForward).filter(Number.isFinite)),maxUp:avg(mets.map(x=>x.maxUp)),hit5:mets.filter(x=>x.hit5).length/mets.length*100,hit10:mets.filter(x=>x.hit10).length/mets.length*100,down:avg(mets.map(x=>x.maxDown))};
}

async function runBacktest(){
  if(running)return;stopRequested=false;
  try{
    const c=getCfg();validateCfg(c);const rows=await loadUniverse();const s=$('btStart').value,e=$('btEnd').value;
    if(!s||!e||s>e)throw new Error('검증 시작일과 종료일을 확인하세요.');
    setRunning(true);startTimer();await ensureAllHistories(rows);if(stopRequested)return;
    const dates=referenceDates(rows,s,e),step=clamp(+$('btStep').value||5,3,30),forward=clamp(+$('btForward').value||20,3,40),topN=clamp(+$('btTopN').value||30,1,100);
    const picked=dates.filter((_,i)=>i%step===0);backtestRows=[];let totalSignals=[];
    for(let di=0;di<picked.length;di++){
      if(stopRequested)break;const date=picked[di],signals=[];
      for(const stock of rows){const bars=historyCache.get(stock.code);if(!bars)continue;const endIdx=endIndexForDate(bars,date);if(endIdx<35)continue;const a=analyzeAt(bars,endIdx,c,false);if(a)signals.push(makeResult(stock,bars,a));}
      signals.sort((a,b)=>b.score-a.score);const chosen=signals.slice(0,topN);totalSignals.push(...chosen);const sm=summaryForSignals(chosen,forward);backtestRows.push({date,...sm});
      $('status').textContent=`백테스트 ${di+1}/${picked.length} · ${isoFromYmd(date)} · 신호 ${chosen.length}`;$('bar').style.width=`${picked.length?(di+1)/picked.length*100:0}%`;$('progressTxt').textContent=`${di+1} / ${picked.length}`;
      if(di%2===0)await sleep(0);
    }
    renderBacktest();const all=summaryForSignals(totalSignals,forward);
    $('backtestSummary').innerHTML=`<b>전체 ${fmt(totalSignals.length)}개 신호 인스턴스</b> · 평균 ${forward}거래일 종가수익 <b>${pctText(all.close)}</b> · 평균 기간내 최고상승 <b>${pctText(all.maxUp)}</b> · +5% 도달률 <b>${Number.isFinite(all.hit5)?all.hit5.toFixed(1)+'%':'-'}</b> · +10% 도달률 <b>${Number.isFinite(all.hit10)?all.hit10.toFixed(1)+'%':'-'}</b> · 평균 최대낙폭 <b>${pctText(all.down)}</b><br><span class="muted">같은 종목이 여러 기준일에 반복 검출되면 각각 하나의 신호로 집계합니다. 하루 신호는 점수 상위 ${topN}개까지만 사용합니다.</span>`;
    $('status').textContent=stopRequested?'백테스트 중지됨':'백테스트 완료';
  }catch(e){$('status').textContent=`백테스트 오류: ${e.message||e}`;}
  finally{setRunning(false);stopTimer();}
}
$('backtestBtn').addEventListener('click',runBacktest);
function renderBacktest(){
  const tb=$('btBody');if(!backtestRows.length){tb.innerHTML='<tr><td colspan="7" class="empty">백테스트 결과가 없습니다.</td></tr>';return;}
  tb.innerHTML=backtestRows.map(r=>`<tr><td>${isoFromYmd(r.date)}</td><td>${r.n}</td><td>${pctText(r.close)}</td><td>${pctText(r.maxUp)}</td><td>${Number.isFinite(r.hit5)?r.hit5.toFixed(1)+'%':'-'}</td><td>${Number.isFinite(r.hit10)?r.hit10.toFixed(1)+'%':'-'}</td><td>${pctText(r.down)}</td></tr>`).join('');
}

$('healthBtn').addEventListener('click',async()=>{
  try{
    $('status').textContent='데이터 연결 점검 중...';
    const [m,r]=await Promise.all([getMasterUniverse(),fetchWithRetry('/data/chart/005930',{},1)]);const b=parseFchart(await r.text());
    $('status').textContent=`정상 · 종목목록 ${fmt(m.length)}개 · 삼성전자 일봉 ${fmt(b.length)}개`;
  }catch(e){$('status').textContent=`연결 오류: ${e.message||e}`;}
});

$('excelBtn').addEventListener('click',()=>{
  if(typeof XLSX==='undefined')return alert('Excel 모듈을 불러오지 못했습니다.');if(!results.length)return;
  const rows=results.map((r,i)=>({
    '순위':i+1,'점수':r.score,'단계':stageText(r),'시장':r.market,'종목명':r.name,'종목코드':r.code,'기준일':isoFromYmd(r.asOf),'기준일종가':r.asOfClose,
    '골든크로스일':isoFromYmd(barsDate(r.code,r.gcIdx)),'골든크로스종가':historyCache.get(r.code)?.[r.gcIdx]?.close,
    '고점일':isoFromYmd(barsDate(r.code,r.peakIdx)),'고점':r.peakHigh,'교차후상승률':r.rise,'조정비율':r.retr,
    'MA5_1저점일':isoFromYmd(barsDate(r.code,r.bottomIdx)),'MA5_1저점':r.bottomMa5,'1저점최근성':r.bottomAge,'MA5하락연속일':r.downCount,
    '현재가_1저점거리':r.priceBottomDist,'현재MA5_1저점거리':r.ma5BottomDist,'MA5반등률':r.turnPct,
    '향후3일':r.f.r3,'향후5일':r.f.r5,'향후10일':r.f.r10,'향후20일':r.f.r20,'20일내최고상승':r.f.maxUp,'20일내최대낙폭':r.f.maxDown,
    '네이버증권':`https://finance.naver.com/item/main.naver?code=${r.code}`
  }));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'1저점검색');
  if(backtestRows.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(backtestRows),'기간백테스트');
  XLSX.writeFile(wb,`GC_급등_MA5_1저점_${$('asOf').value||'result'}.xlsx`);
});

(function init(){
  $('asOf').value=localIsoDate();$('btStart').value=daysAgo(150);$('btEnd').value=daysAgo(35);
  if(localStorage.getItem(DEVICE_KEY)===LOCK){showApp();loadUniverse();}else showLogin();
})();
