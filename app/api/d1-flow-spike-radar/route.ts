import { NextResponse } from 'next/server';
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SCOPE = 'd1-flow-spike-radar-20261001-v1';
const ACCESS_CODE_HASH = '696db21cbff09ada1a61dce8499bd5de35f5f8a7f68a90ac294e091a131ca70f';
const CACHE_TTL = 10 * 60 * 1000;
const themeCache = { time: 0, data: [] as any[] };
const memberCache = new Map<string,{time:number,data:any[]}>();

function secret(){ return process.env.SESSION_SECRET || ''; }
function sign(payload:string){ return crypto.createHmac('sha256', `${secret()}:${SCOPE}`).update(payload).digest('base64url'); }
function createToken(){ const p = `${SCOPE}.${crypto.randomBytes(24).toString('base64url')}`; return `${p}.${sign(p)}`; }
function requestToken(req:Request){
  return req.headers.get('x-auth-token') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i,'');
}
function validToken(token?:string|null){
  if(!token || !secret()) return false;
  const i = token.lastIndexOf('.');
  if(i < 0) return false;
  const p = token.slice(0,i), s = token.slice(i+1);
  if(!p.startsWith(`${SCOPE}.`)) return false;
  const e = sign(p);
  if(s.length !== e.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e)); } catch { return false; }
}
function validPassword(v:string){
  if(!secret()) return false;
  const actual = crypto.createHash('sha256').update(String(v || '').trim()).digest();
  try { return actual.length === 32 && crypto.timingSafeEqual(actual, Buffer.from(ACCESS_CODE_HASH,'hex')); } catch { return false; }
}
function unauthorized(){ return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers:{'Cache-Control':'no-store'}}); }

function n(v:any){
  if(typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const x = Number(String(v ?? '').replace(/[,%+원주\s]/g,''));
  return Number.isFinite(x) ? x : 0;
}
function round(v:number,p=2){ const m=10**p; return Math.round(v*m)/m; }
function clamp(v:number,a:number,b:number){ return Math.max(a,Math.min(b,v)); }
function ymd(v:any){ return String(v ?? '').replace(/\D/g,'').slice(0,8); }
function dashDate(v:any){ const s=ymd(v); return /^\d{8}$/.test(s) ? s.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3') : String(v ?? ''); }
const sleep = (ms:number)=>new Promise(r=>setTimeout(r,ms));

async function fetchRaw(url:string,timeoutMs=10000,accept='application/json,text/plain,*/*'){
  let last = '';
  for(let attempt=0; attempt<3; attempt++){
    const c = new AbortController(), t = setTimeout(()=>c.abort(), timeoutMs);
    try{
      const r = await fetch(url,{
        signal:c.signal, cache:'no-store',
        headers:{
          'User-Agent':'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
          'Accept':accept, 'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.6',
          'Referer':url.includes('finance.naver.com') ? 'https://finance.naver.com/' : 'https://m.stock.naver.com/'
        }
      });
      if(!r.ok){ last=`HTTP ${r.status}`; await sleep(160*(attempt+1)); continue; }
      return r;
    }catch(e:any){ last=String(e?.message || e); await sleep(160*(attempt+1)); }
    finally{ clearTimeout(t); }
  }
  throw new Error(last || 'FETCH_FAILED');
}
async function fetchJson(url:string,timeoutMs=10000){
  const r=await fetchRaw(url,timeoutMs); const tx=await r.text();
  try { return JSON.parse(tx); } catch { throw new Error('JSON_PARSE_FAILED'); }
}
async function fetchHtml(url:string,timeoutMs=10000){
  const r=await fetchRaw(url,timeoutMs,'text/html,application/xhtml+xml,*/*');
  const b=Buffer.from(await r.arrayBuffer()), ct=(r.headers.get('content-type')||'').toLowerCase();
  return ct.includes('utf-8') ? b.toString('utf8') : iconv.decode(b,'EUC-KR');
}
function pickArray(j:any,keys:string[]){
  if(Array.isArray(j)) return j;
  for(const k of keys){
    if(Array.isArray(j?.[k])) return j[k];
    if(Array.isArray(j?.result?.[k])) return j.result[k];
  }
  if(Array.isArray(j?.result)) return j.result;
  return [];
}
function normalizeMarket(v:any){
  const s=String(v||'').toUpperCase();
  if(s.includes('KOSDAQ') || s==='KQ' || s==='2') return 'KOSDAQ';
  if(s.includes('KOSPI') || s==='KS' || s==='1') return 'KOSPI';
  return 'UNKNOWN';
}

function normalizeTheme(x:any){
  const code=String(x?.code??x?.sectorCode??x?.detailNo??x?.no??'').replace(/\D/g,'');
  const name=String(x?.name??x?.sectorName??x?.themeName??'').trim();
  if(!code||!name) return null;
  const up=n(x?.risingCount??x?.risingStockCount??x?.riseCount??x?.upCount);
  const down=n(x?.fallingCount??x?.fallingStockCount??x?.fallCount??x?.downCount);
  const flat=n(x?.unchangedCount??x?.unchangedStockCount??x?.steadyCount??x?.flatCount);
  return {code,name,changePct:n(x?.changeRate??x?.fluctuationsRatio??x?.changePct??x?.rate),up,down,flat,count:n(x?.stockCount??x?.itemCount??x?.totalCount)||(up+down+flat),source:'Naver'};
}
async function loadThemesFront(){
  const out:any[]=[]; let cursor=''; const seen=new Set<string>();
  for(let turn=0;turn<12;turn++){
    const base='https://m.stock.naver.com/front-api/stock/sectors/all?nationType=domestic&sectorType=theme&sectorSortType=CHANGE_RATE&businessDayCategory=daily&pageSize=50';
    const url=cursor?`${base}&cursor=${encodeURIComponent(cursor)}`:base;
    const j=await fetchJson(url,10000), rows=pickArray(j,['sectors','items','stocks','data']);
    if(!rows.length) break;
    for(const x of rows){ const t=normalizeTheme(x); if(t) out.push(t); }
    const next=String(j?.result?.cursor||'');
    if(j?.result?.hasNext===false || !next || next===cursor || seen.has(next)) break;
    seen.add(next); cursor=next;
  }
  const uniq=[...new Map(out.map(x=>[x.code,x])).values()];
  if(!uniq.length) throw new Error('THEME_FRONT_EMPTY');
  return uniq;
}
async function loadThemesLegacy(){
  const out:any[]=[];
  for(let page=1;page<=8;page++){
    const html=await fetchHtml(`https://finance.naver.com/sise/theme.naver?page=${page}`,10000), $=cheerio.load(html);
    let count=0;
    $('a[href*="sise_group_detail.naver?type=theme"]').each((_,el)=>{
      const a=$(el), href=a.attr('href')||'', m=href.match(/[?&]no=(\d+)/), name=a.text().replace(/\s+/g,' ').trim();
      if(!m||!name) return;
      const tr=a.closest('tr'), cells=tr.find('td').map((_,td)=>$(td).text().replace(/\s+/g,' ').trim()).get();
      let change=0; for(const c of cells){ if(/[-+]?\d+(?:\.\d+)?%/.test(c)){ change=n(c); break; } }
      out.push({code:m[1],name,changePct:change,up:0,down:0,flat:0,count:0,source:'Naver legacy'}); count++;
    });
    if(!count) break;
  }
  const uniq=[...new Map(out.map(x=>[x.code,x])).values()];
  if(!uniq.length) throw new Error('THEME_LEGACY_EMPTY');
  return uniq;
}
async function loadThemes(force=false){
  if(!force && themeCache.data.length && Date.now()-themeCache.time<CACHE_TTL) return themeCache.data;
  let data:any[]=[];
  try{ data=await loadThemesFront(); }catch{ data=await loadThemesLegacy(); }
  data.sort((a,b)=>b.changePct-a.changePct);
  themeCache.time=Date.now(); themeCache.data=data; return data;
}

function normalizeMember(x:any){
  const raw=String(x?.itemCode??x?.stockCode??x?.code??'').replace(/\D/g,''), code=raw.match(/\d{6}/)?.[0]||'';
  const name=String(x?.stockName??x?.itemName??x?.name??'').trim();
  if(!code||!name) return null;
  return {
    code,name,market:normalizeMarket(x?.marketType??x?.stockExchangeType?.name??x?.stockExchangeType??x?.market??x?.category),
    price:n(x?.closePrice??x?.currentPrice??x?.nowVal??x?.price)||null,
    changePct:n(x?.fluctuationsRatio??x?.changeRate??x?.changePct??x?.rate),
    marketValue:n(x?.marketValue??x?.marketCap)||null
  };
}
async function loadThemeMembersFront(code:string){
  const out:any[]=[];
  for(let page=1;page<=6;page++){
    const url=`https://m.stock.naver.com/front-api/domestic/sector/item/list?sectorCode=${encodeURIComponent(code)}&sectorType=theme&sectorSortType=CHANGE_RATE&page=${page}&pageSize=100`;
    const j=await fetchJson(url,10000), rows=pickArray(j,['stocks','items','result','data']);
    if(!rows.length) break;
    for(const x of rows){ const s=normalizeMember(x); if(s) out.push(s); }
    if(rows.length<100 || j?.result?.hasNext===false) break;
  }
  const uniq=[...new Map(out.map(x=>[x.code,x])).values()];
  if(!uniq.length) throw new Error('MEMBER_FRONT_EMPTY');
  return uniq;
}
async function loadThemeMembersLegacy(code:string){
  const html=await fetchHtml(`https://finance.naver.com/sise/sise_group_detail.naver?type=theme&no=${encodeURIComponent(code)}`,10000), $=cheerio.load(html), out:any[]=[];
  $('a[href*="/item/main.naver?code="]').each((_,el)=>{
    const a=$(el), href=a.attr('href')||'', m=href.match(/code=(\d{6})/), name=a.text().replace(/\s+/g,' ').trim();
    if(!m||!name) return;
    const tr=a.closest('tr'), cells=tr.find('td').map((_,td)=>$(td).text().replace(/\s+/g,' ').trim()).get();
    let price=0,change=0;
    for(const c of cells){ if(!price&&/^\d[\d,]*$/.test(c)) price=n(c); if(/[-+]?\d+(?:\.\d+)?%/.test(c)){change=n(c);break;} }
    out.push({code:m[1],name,market:'UNKNOWN',price:price||null,changePct:change,marketValue:null});
  });
  const uniq=[...new Map(out.map(x=>[x.code,x])).values()];
  if(!uniq.length) throw new Error('MEMBER_LEGACY_EMPTY');
  return uniq;
}
async function loadThemeMembers(code:string,force=false){
  const c=memberCache.get(code);
  if(!force && c && Date.now()-c.time<CACHE_TTL) return c.data;
  let data:any[]=[];
  try{ data=await loadThemeMembersFront(code); }catch{ data=await loadThemeMembersLegacy(code); }
  memberCache.set(code,{time:Date.now(),data}); return data;
}

type Bar={date:string;open:number;high:number;low:number;close:number;volume:number;ma5?:number|null;ma20?:number|null;ma60?:number|null};
function sma(a:number[],w:number,i:number){ if(i<w-1) return null; let s=0; for(let k=i-w+1;k<=i;k++) s+=a[k]; return s/w; }
async function loadHistory(code:string,asOf:string,lookbackDays:number){
  const count=clamp(Math.ceil(lookbackDays*2.2)+100,220,1000), end=ymd(asOf)||'99999999';
  const r=await fetchRaw(`https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(code)}&timeframe=day&count=${count}&requestType=0`,12000,'text/xml,text/plain,*/*');
  const xml=await r.text(), out:Bar[]=[];
  for(const m of xml.matchAll(/<item\s+data=["']([^"']+)["']/g)){
    const [date,o,h,l,c,v]=m[1].split('|'), close=Number(c);
    if(!/^\d{8}$/.test(date)||date>end||!Number.isFinite(close)||close<=0) continue;
    out.push({date,open:Number(o)||close,high:Number(h)||close,low:Number(l)||close,close,volume:Number(v)||0});
  }
  out.sort((a,b)=>a.date.localeCompare(b.date));
  if(out.length<65) throw new Error('HISTORY_SHORT');
  return out;
}

type Trend={date:string;foreign:number;institution:number;individual:number;holdRatio:number;close:number;source:string};
function trendRow(x:any,source:string):Trend|null{
  const date=ymd(x?.localDate??x?.date??x?.tradeDate??x?.bizdate??x?.['날짜']??x?.['일자']);
  if(!/^\d{8}$/.test(date)) return null;
  return {
    date,
    foreign:n(x?.foreignerPureBuyQuant??x?.foreignPureBuyQuant??x?.foreignerNetBuyQuantity??x?.foreignNetBuy??x?.['외국인 순매매량']??x?.['외국인']),
    institution:n(x?.organPureBuyQuant??x?.institutionPureBuyQuant??x?.institutionNetBuyQuantity??x?.organNetBuy??x?.['기관 순매매량']??x?.['기관']),
    individual:n(x?.individualPureBuyQuant??x?.personalPureBuyQuant??x?.individualNetBuyQuantity??x?.['개인 순매매량']??x?.['개인']),
    holdRatio:n(x?.foreignerHoldRatio??x?.foreignHoldRatio??x?.['외국인 보유율']??x?.['보유율']),
    close:n(x?.closePrice??x?.close??x?.['종가']),
    source
  };
}
async function loadTrendMobile(code:string){
  const urls=[
    `https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/trend`,
    `https://m.stock.naver.com/front-api/stock/domestic/trend?code=${encodeURIComponent(code)}`
  ];
  let last='';
  for(const url of urls){
    try{
      const j=await fetchJson(url,10000), rows=pickArray(j,['dealTrendInfos','trendInfos','items','data']);
      const out=rows.map((x:any)=>trendRow(x,'Naver mobile trend')).filter(Boolean) as Trend[];
      if(out.length){ out.sort((a,b)=>b.date.localeCompare(a.date)); return out; }
    }catch(e:any){ last=String(e?.message||e); }
  }
  throw new Error(last||'TREND_MOBILE_EMPTY');
}
async function loadTrendLegacy(code:string,asOf:string){
  const target=ymd(asOf), out:Trend[]=[]; let covered=false;
  for(let page=1;page<=12;page++){
    const html=await fetchHtml(`https://finance.naver.com/item/frgn.naver?code=${encodeURIComponent(code)}&page=${page}`,10000), $=cheerio.load(html);
    let rows=0, oldest='99999999';
    $('table.type2 tr').each((_,tr)=>{
      const cells=$(tr).find('td').map((_,td)=>$(td).text().replace(/\s+/g,' ').trim()).get();
      if(cells.length<7) return;
      const date=ymd(cells[0]); if(!/^\d{8}$/.test(date)) return;
      rows++; if(date<oldest) oldest=date;
      out.push({date,close:n(cells[1]),institution:n(cells[5]),foreign:n(cells[6]),individual:0,holdRatio:n(cells[8]||0),source:'Naver PC investor'});
    });
    if(!rows) break;
    if(target && oldest<=target){ covered=true; break; }
  }
  const uniq=[...new Map(out.map(x=>[x.date,x])).values()].sort((a,b)=>b.date.localeCompare(a.date));
  if(!uniq.length) throw new Error('TREND_LEGACY_EMPTY');
  if(target && !covered && uniq[uniq.length-1].date>target) throw new Error('TREND_TARGET_OUT_OF_RANGE');
  return uniq;
}
async function loadTrend(code:string,asOf:string){
  const target=ymd(asOf);
  try{
    const rows=await loadTrendMobile(code);
    const oldest=rows[rows.length-1]?.date||'', latest=rows[0]?.date||'';
    if(!target || (target<=latest && target>=oldest)) return rows;
    if(target>latest) return rows;
  }catch{}
  return loadTrendLegacy(code,asOf);
}

type Cfg={
  asOf:string; lookbackDays:number; maCompressPct:number; near60Pct:number; near20Pct:number; rangeDays:number; rangePct:number;
  minSlope20Pct:number; spikeLookback:number; minSpikePct:number; dryVolumeRatio:number; volumeSurgeLookback:number; minVolumeSurge:number;
  higherLowDays:number; minHigherLowPct:number; minForeignDayPct:number; minForeign5Pct:number; minForeignPositiveDays:number; minJointDays:number;
  minTotalScore:number; useTechGate:boolean; useForeignToday:boolean; useForeign5:boolean; useForeignAccel:boolean; useInstitution:boolean; useJoint:boolean; useSellExhaust:boolean;
};

function analyseTechnical(rows:Bar[],cfg:Cfg){
  const closes=rows.map(x=>x.close);
  for(let i=0;i<rows.length;i++){ rows[i].ma5=sma(closes,5,i); rows[i].ma20=sma(closes,20,i); rows[i].ma60=sma(closes,60,i); }
  const i=rows.length-1, cur=rows[i];
  if(!cur.ma5||!cur.ma20||!cur.ma60) return null;
  const mas=[cur.ma5,cur.ma20,cur.ma60] as number[];
  const compress=(Math.max(...mas)-Math.min(...mas))/cur.close*100;
  const d60=(cur.close-cur.ma60)/cur.ma60*100, d20=(cur.close-cur.ma20)/cur.ma20*100;
  const b20=i>=5?rows[i-5].ma20:null, slope20=b20?((cur.ma20-b20)/b20*100):0;
  const rs=rows.slice(Math.max(0,i-cfg.rangeDays+1),i+1);
  const recentRange=(Math.max(...rs.map(x=>x.high))-Math.min(...rs.map(x=>x.low)))/cur.close*100;
  const av20=rows.slice(Math.max(0,i-19),i+1).reduce((s,x)=>s+x.volume,0)/Math.min(20,i+1);
  const dryRatio=av20?cur.volume/av20:1;
  let spikePct=-999, spikeDate='';
  for(let k=Math.max(1,i-cfg.spikeLookback);k<=i;k++){ const pct=(rows[k].close/rows[k-1].close-1)*100; if(pct>spikePct){spikePct=pct;spikeDate=rows[k].date;} }
  let surge=0, surgeDate='';
  for(let k=Math.max(20,i-cfg.volumeSurgeLookback);k<=i;k++){
    const base=rows.slice(Math.max(0,k-20),k).reduce((s,x)=>s+x.volume,0)/Math.max(1,Math.min(20,k));
    const r=base?rows[k].volume/base:0; if(r>surge){surge=r;surgeDate=rows[k].date;}
  }
  const hd=Math.max(3,cfg.higherLowDays);
  const recentLow=Math.min(...rows.slice(Math.max(0,i-hd+1),i+1).map(x=>x.low));
  const prevSlice=rows.slice(Math.max(0,i-hd*2+1),Math.max(1,i-hd+1));
  const prevLow=prevSlice.length?Math.min(...prevSlice.map(x=>x.low)):recentLow;
  const higherLowPct=prevLow?((recentLow-prevLow)/prevLow*100):0;

  const checks={
    compress:compress<=cfg.maCompressPct,
    near60:Math.abs(d60)<=cfg.near60Pct,
    near20:Math.abs(d20)<=cfg.near20Pct,
    range:recentRange<=cfg.rangePct,
    slope20:slope20>=cfg.minSlope20Pct,
    priorSpike:spikePct>=cfg.minSpikePct,
    dry:dryRatio<=cfg.dryVolumeRatio,
    volumeSurge:surge>=cfg.minVolumeSurge,
    higherLow:higherLowPct>=cfg.minHigherLowPct
  };
  let score=0;
  if(checks.compress)score+=10; if(checks.near60)score+=7; if(checks.near20)score+=7; if(checks.range)score+=6;
  if(checks.slope20)score+=4; if(checks.priorSpike)score+=8; if(checks.dry)score+=5; if(checks.volumeSurge)score+=5; if(checks.higherLow)score+=3;
  return {
    price:cur.close, volume:cur.volume, ma5:round(cur.ma5),ma20:round(cur.ma20),ma60:round(cur.ma60),
    compressPct:round(compress),d20Pct:round(d20),d60Pct:round(d60),rangePct:round(recentRange),slope20Pct:round(slope20),
    dryVolumeRatio:round(dryRatio),priorSpikePct:round(spikePct),priorSpikeDate:dashDate(spikeDate),volumeSurge:round(surge),volumeSurgeDate:dashDate(surgeDate),
    higherLowPct:round(higherLowPct),techScore:score,checks,asOf:dashDate(cur.date)
  };
}

function analyseFlow(trends:Trend[],rows:Bar[],cfg:Cfg){
  const target=ymd(cfg.asOf);
  const usable=trends.filter(x=>!target||x.date<=target).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10);
  if(!usable.length) return null;
  const volumeByDate=new Map(rows.map(x=>[x.date,x.volume]));
  const ratios=usable.map(x=>{ const v=volumeByDate.get(x.date)||0; return {...x,volume:v,foreignPct:v?x.foreign/v*100:0,instPct:v?x.institution/v*100:0}; });
  const first=ratios[0], r3=ratios.slice(0,3), r5=ratios.slice(0,5);
  const sf=(a:any[])=>a.reduce((s,x)=>s+x.foreign,0), si=(a:any[])=>a.reduce((s,x)=>s+x.institution,0), sv=(a:any[])=>a.reduce((s,x)=>s+x.volume,0);
  const f3=sf(r3),f5=sf(r5),i3=si(r3),i5=si(r5),v5=sv(r5);
  const f5Pct=v5?f5/v5*100:0, i5Pct=v5?i5/v5*100:0;
  const foreignPositiveDays=r5.filter(x=>x.foreign>0).length, instPositiveDays=r5.filter(x=>x.institution>0).length, jointDays=r5.filter(x=>x.foreign>0&&x.institution>0).length;
  const a2=ratios.slice(0,2), p3=ratios.slice(2,5);
  const avg=(a:any[],k:string)=>a.length?a.reduce((s,x)=>s+Number(x[k]||0),0)/a.length:0;
  const accelPct=avg(a2,'foreignPct')-avg(p3,'foreignPct');
  const prev3=sf(ratios.slice(1,4));
  const sellExhaust=(first.foreign>0&&prev3<0) || (first.foreign<0 && prev3<0 && first.foreign>prev3/3);
  const holdDelta=ratios.length>=2 ? first.holdRatio-ratios[Math.min(4,ratios.length-1)].holdRatio : 0;
  const checks={
    foreignToday:first.foreignPct>=cfg.minForeignDayPct,
    foreign5:f5Pct>=cfg.minForeign5Pct,
    foreignPositiveDays:foreignPositiveDays>=cfg.minForeignPositiveDays,
    foreignAccel:accelPct>0,
    institution:i3>0,
    joint:jointDays>=cfg.minJointDays,
    sellExhaust
  };
  let score=0;
  if(checks.foreignToday)score+=8;
  if(checks.foreign5)score+=7;
  if(checks.foreignPositiveDays)score+=5;
  if(checks.foreignAccel)score+=7;
  if(checks.institution)score+=6;
  if(checks.joint)score+=6;
  if(checks.sellExhaust)score+=6;
  return {
    flowDate:dashDate(first.date), foreign1d:first.foreign, institution1d:first.institution, individual1d:first.individual,
    foreign1dPct:round(first.foreignPct,3), institution1dPct:round(first.instPct,3),
    foreign3d:f3, foreign5d:f5, institution3d:i3, institution5d:i5, foreign5dPct:round(f5Pct,3), institution5dPct:round(i5Pct,3),
    foreignPositiveDays5:foreignPositiveDays, institutionPositiveDays5:instPositiveDays, jointDays5:jointDays,
    foreignAccelPct:round(accelPct,3), sellExhaust, holdRatio:first.holdRatio, holdRatioDelta5:round(holdDelta,3), flowScore:score, checks,
    source:first.source,
    recent:ratios.slice(0,5).map(x=>({date:dashDate(x.date),foreign:x.foreign,institution:x.institution,foreignPct:round(x.foreignPct,3),instPct:round(x.instPct,3),holdRatio:x.holdRatio}))
  };
}

function passFlowGate(flow:any,cfg:Cfg){
  if(!flow) return false;
  const c=flow.checks||{};
  if(cfg.useForeignToday&&!c.foreignToday)return false;
  if(cfg.useForeign5&&!(c.foreign5||c.foreignPositiveDays))return false;
  if(cfg.useForeignAccel&&!c.foreignAccel)return false;
  if(cfg.useInstitution&&!c.institution)return false;
  if(cfg.useJoint&&!c.joint)return false;
  if(cfg.useSellExhaust&&!c.sellExhaust)return false;
  return true;
}

async function loadBasic(code:string){
  const urls=[`https://m.stock.naver.com/api/stock/${code}/basic`,`https://m.stock.naver.com/front-api/stock/domestic/basic?code=${code}&endType=stock`];
  for(const u of urls){
    try{
      const j=await fetchJson(u,8000);
      return {name:String(j?.stockName??j?.itemName??''),market:normalizeMarket(j?.stockExchangeType?.name??j?.stockExchangeType??j?.marketType),price:n(j?.closePrice??j?.currentPrice)};
    }catch{}
  }
  return {name:'',market:'UNKNOWN',price:0};
}

async function scanOne(s:any,cfg:Cfg){
  const code=String(s?.code||'').replace(/\D/g,'').slice(0,6);
  try{
    const [rows,trends,basic]=await Promise.all([loadHistory(code,cfg.asOf,cfg.lookbackDays),loadTrend(code,cfg.asOf),loadBasic(code)]);
    const tech=analyseTechnical(rows,cfg), flow=analyseFlow(trends,rows,cfg);
    if(!tech||!flow) throw new Error('ANALYSIS_EMPTY');
    const total=tech.techScore+flow.flowScore;
    const techGate=tech.techScore>=28;
    const flowGate=passFlowGate(flow,cfg);
    const pass=(!cfg.useTechGate||techGate)&&flowGate&&total>=cfg.minTotalScore;
    const reasons:string[]=[];
    if(tech.checks.compress)reasons.push('이평압축');
    if(tech.checks.near20)reasons.push('20일선근접');
    if(tech.checks.near60)reasons.push('60일선근접');
    if(tech.checks.priorSpike)reasons.push('과거급등');
    if(flow.checks.foreignToday)reasons.push('외인당일매수');
    if(flow.checks.foreign5)reasons.push('외인5일누적');
    if(flow.checks.foreignAccel)reasons.push('외인매수속도↑');
    if(flow.checks.institution)reasons.push('기관동행');
    if(flow.checks.joint)reasons.push('외인+기관동시');
    if(flow.checks.sellExhaust)reasons.push('외인매도약화/반전');
    let grade='관찰';
    if(total>=82&&tech.techScore>=35&&flow.flowScore>=28)grade='A+';
    else if(total>=72)grade='A';
    else if(total>=62)grade='B';
    return {
      code,name:String(s?.name||basic.name||code),market:String(s?.market&&s.market!=='UNKNOWN'?s.market:basic.market),theme:String(s?.theme||'직접입력'),
      pass,grade,totalScore:total,reasons,tech,flow,
      naver:`https://finance.naver.com/item/main.naver?code=${code}`,
      investor:`https://finance.naver.com/item/frgn.naver?code=${code}`
    };
  }catch(e:any){
    return {code,name:String(s?.name||code),market:String(s?.market||'UNKNOWN'),theme:String(s?.theme||'직접입력'),scanError:String(e?.message||e)};
  }
}

export async function GET(req:Request){
  const u=new URL(req.url), op=u.searchParams.get('op')||'';
  if(!validToken(requestToken(req))) return unauthorized();
  if(op==='themes'){
    try{ const themes=await loadThemes(u.searchParams.get('force')==='1'); return NextResponse.json({themes,count:themes.length},{headers:{'Cache-Control':'no-store'}}); }
    catch(e:any){ return NextResponse.json({error:'THEMES_FAILED',message:String(e?.message||e)},{status:502}); }
  }
  if(op==='members'){
    const code=String(u.searchParams.get('themeCode')||'').replace(/\D/g,'');
    if(!code) return NextResponse.json({error:'NO_THEME_CODE'},{status:400});
    try{ const members=await loadThemeMembers(code,u.searchParams.get('force')==='1'); return NextResponse.json({members,count:members.length,themeCode:code},{headers:{'Cache-Control':'no-store'}}); }
    catch(e:any){ return NextResponse.json({error:'THEME_MEMBERS_FAILED',message:String(e?.message||e)},{status:502}); }
  }
  return NextResponse.json({error:'BAD_OP'},{status:400});
}

export async function POST(req:Request){
  const u=new URL(req.url), op=u.searchParams.get('op')||'', body:any=await req.json().catch(()=>({}));
  if(op==='login'){
    if(!process.env.SESSION_SECRET) return NextResponse.json({error:'AUTH_NOT_CONFIGURED'},{status:503});
    if(!validPassword(String(body?.code||body?.password||''))) return NextResponse.json({error:'INVALID_CODE'},{status:401});
    return NextResponse.json({ok:true,token:createToken()},{headers:{'Cache-Control':'no-store'}});
  }
  if(!validToken(requestToken(req))) return unauthorized();
  if(op==='scan'){
    const stocks=Array.isArray(body.stocks)?body.stocks.slice(0,12):[];
    if(!stocks.length) return NextResponse.json({error:'NO_STOCKS'},{status:400});
    const b=body.cfg||body;
    const cfg:Cfg={
      asOf:String(b.asOf||''),lookbackDays:clamp(Number(b.lookbackDays??180),90,420),
      maCompressPct:clamp(Number(b.maCompressPct??12),1,40),near60Pct:clamp(Number(b.near60Pct??10),1,40),near20Pct:clamp(Number(b.near20Pct??7),1,30),
      rangeDays:clamp(Number(b.rangeDays??10),5,30),rangePct:clamp(Number(b.rangePct??18),3,60),minSlope20Pct:clamp(Number(b.minSlope20Pct??-1.5),-10,10),
      spikeLookback:clamp(Number(b.spikeLookback??120),20,240),minSpikePct:clamp(Number(b.minSpikePct??8),2,30),dryVolumeRatio:clamp(Number(b.dryVolumeRatio??1.2),0.1,5),
      volumeSurgeLookback:clamp(Number(b.volumeSurgeLookback??120),20,240),minVolumeSurge:clamp(Number(b.minVolumeSurge??2),1,10),
      higherLowDays:clamp(Number(b.higherLowDays??10),3,30),minHigherLowPct:clamp(Number(b.minHigherLowPct??-3),-20,20),
      minForeignDayPct:clamp(Number(b.minForeignDayPct??0.3),-10,20),minForeign5Pct:clamp(Number(b.minForeign5Pct??0.2),-10,20),
      minForeignPositiveDays:clamp(Number(b.minForeignPositiveDays??3),1,5),minJointDays:clamp(Number(b.minJointDays??1),0,5),minTotalScore:clamp(Number(b.minTotalScore??62),0,100),
      useTechGate:b.useTechGate!==false,useForeignToday:!!b.useForeignToday,useForeign5:b.useForeign5!==false,useForeignAccel:!!b.useForeignAccel,
      useInstitution:!!b.useInstitution,useJoint:!!b.useJoint,useSellExhaust:!!b.useSellExhaust
    };
    if(!/^\d{4}-\d{2}-\d{2}$/.test(cfg.asOf)||stocks.some((s:any)=>! /^\d{6}$/.test(String(s.code||'')))){
      return NextResponse.json({error:'BAD_SETTINGS',message:'기준일 또는 종목코드를 확인해 주세요.'},{status:400});
    }
    const results:any[]=[],errors:any[]=[];
    for(let i=0;i<stocks.length;i+=4){
      const rr=await Promise.all(stocks.slice(i,i+4).map((s:any)=>scanOne(s,cfg)));
      for(const r of rr){ if(r?.scanError) errors.push(r); else results.push(r); }
    }
    results.sort((a,b)=>Number(b.totalScore||0)-Number(a.totalScore||0));
    return NextResponse.json({results,errors,asOf:cfg.asOf,count:results.length},{headers:{'Cache-Control':'no-store'}});
  }
  return NextResponse.json({error:'BAD_OP'},{status:400});
}
