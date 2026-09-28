const $ = id => document.getElementById(id);
const LOCK = '19e5afe03ed07447185162e747fcabc8128d5d6c0caa2ece63ec3f0382d109fc';
const DEVICE_KEY = 'gc_retrace_ma5_w_device_v1';
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
  try{ $('loginErr').textContent='확인 중...'; const h=await sha256($('code').value.trim()); if(h!==LOCK) throw new Error('인증번호가 맞지 않습니다.'); localStorage.setItem(DEVICE_KEY,LOCK); $('loginErr').textContent=''; showApp(); await loadUniverse(); }
  catch(e){ $('loginErr').textContent=e.message||String(e); }
}
$('loginBtn').addEventListener('click',login); $('code').addEventListener('keydown',e=>{if(e.key==='Enter')login();});
$('logoutBtn').addEventListener('click',()=>{localStorage.removeItem(DEVICE_KEY);showLogin();});

async function fetchWithRetry(url, options={}, tries=2){
  let last;
  for(let i=0;i<=tries;i++){
    try{ const r=await fetch(url,{cache:'no-store',...options}); if(r.ok)return r; last=new Error(`HTTP ${r.status}`); if(![408,429,500,502,503,504].includes(r.status))throw last; }
    catch(e){last=e;} if(i<tries)await sleep(250+Math.random()*350+i*450);
  }
  throw last||new Error('데이터 요청 실패');
}
async function loadMaster(market){
  if(typeof JSZip==='undefined') throw new Error('종목 마스터 압축 해제 모듈을 불러오지 못했습니다.');
  const tail=market==='KOSPI'?228:222;
  const url=market==='KOSPI'?'/data/master/kospi':'/data/master/kosdaq';
  const filename=market==='KOSPI'?'kospi_code.mst':'kosdaq_code.mst';
  const r=await fetchWithRetry(url,{},2); const ab=await r.arrayBuffer(); const zip=await JSZip.loadAsync(ab); const file=zip.file(filename);
  if(!file) throw new Error(`${market} 마스터 파일 누락`);
  const bytes=await file.async('uint8array'); const text=new TextDecoder('euc-kr').decode(bytes); const rows=[];
  for(const row of text.split(/\r?\n/)){
    if(!row)continue; const part1=row.slice(0,row.length-tail); const code=part1.slice(0,9).trim(); if(!/^\d{6}$/.test(code))continue;
    const name=part1.slice(21).trim(); const group=row.slice(-tail).slice(0,2).trim();
    if(market==='KOSPI'&&(group==='E'||group===')E'))continue;
    rows.push({code,name,market,group});
  }
  return rows;
}
async function getMasterUniverse(){
  if(masterCache)return masterCache;
  $('status').textContent='코스피·코스닥 전종목 목록 불러오는 중...';
  const [a,b]=await Promise.all([loadMaster('KOSPI'),loadMaster('KOSDAQ')]); masterCache=[...a,...b]; return masterCache;
}
async function loadUniverse(){
  const all=[...await getMasterUniverse()]; const market=$('market').value; let rows=market==='BOTH'?all:all.filter(x=>x.market===market);
  if($('excludeSpac').checked)rows=rows.filter(x=>!/(스팩|SPAC)/i.test(x.name)); universe=rows;
  $('universeN').textContent=fmt(rows.length); $('cacheN').textContent=fmt([...historyCache.keys()].filter(c=>rows.some(x=>x.code===c)).length);
  const k1=rows.filter(x=>x.market==='KOSPI').length,k2=rows.filter(x=>x.market==='KOSDAQ').length;
  $('status').textContent=`목록 준비 · KOSPI ${fmt(k1)} / KOSDAQ ${fmt(k2)}`; $('progressTxt').textContent=`0 / ${fmt(rows.length)}`; return rows;
}
$('market').addEventListener('change',()=>{if(!running)loadUniverse();}); $('excludeSpac').addEventListener('change',()=>{if(!running)loadUniverse();});

function parseFchart(xml){
  const out=[]; const re=/<item\s+data="([^"]+)"\s*\/?>/g; let m;
  while((m=re.exec(xml))){ const p=m[1].split('|'); if(p.length<6)continue; const [date,open,high,low,close,volume]=p; const nums=[open,high,low,close,volume].map(Number); if(!date||nums.some(v=>!Number.isFinite(v)))continue; out.push({date,open:nums[0],high:nums[1],low:nums[2],close:nums[3],volume:nums[4]}); }
  out.sort((a,b)=>a.date.localeCompare(b.date)); return enhanceBars(out);
}
function enhanceBars(bars){
  let s5=0,s20=0;
  for(let i=0;i<bars.length;i++){
    s5+=bars[i].close; s20+=bars[i].close; if(i>=5)s5-=bars[i-5].close; if(i>=20)s20-=bars[i-20].close;
    bars[i].ma5=i>=4?s5/5:NaN; bars[i].ma20=i>=19?s20/20:NaN;
  }
  return bars;
}
async function getHistory(stock){
  if(historyCache.has(stock.code))return historyCache.get(stock.code);
  const r=await fetchWithRetry(`/data/chart/${stock.code}`,{},2); const bars=parseFchart(await r.text()); if(bars.length<60)throw new Error(`가격 이력 부족(${bars.length})`); historyCache.set(stock.code,bars); return bars;
}
function endIndexForDate(bars,asOf){
  const y=toYmd(asOf); let lo=0,hi=bars.length-1,ans=-1;
  while(lo<=hi){const mid=(lo+hi)>>1;if(bars[mid].date<=y){ans=mid;lo=mid+1}else hi=mid-1;} return ans;
}
function getCfg(){
  return { gcMinDays:+$('gcMinDays').value,gcMaxDays:+$('gcMaxDays').value,minRise:+$('minRise').value,retrMin:+$('retrMin').value,retrMax:+$('retrMax').value,bottomTol:+$('bottomTol').value,bottomMinGap:+$('bottomMinGap').value,bottomMaxGap:+$('bottomMaxGap').value,valleyRise:+$('valleyRise').value,nearBottomDays:+$('nearBottomDays').value,ma5NearTol:+$('ma5NearTol').value,priceMa5Tol:+$('priceMa5Tol').value,preferTurning:$('preferTurning').checked,requireCloseAbove20:$('requireCloseAbove20').checked };
}
function validateCfg(c){
  if(c.gcMinDays>=c.gcMaxDays)throw new Error('골든크로스 최소 경과일은 최대 경과일보다 작아야 합니다.');
  if(c.retrMin>=c.retrMax)throw new Error('조정비율 하단은 상단보다 작아야 합니다.');
  if(c.bottomMinGap>=c.bottomMaxGap)throw new Error('쌍바닥 최소 간격은 최대 간격보다 작아야 합니다.');
}
