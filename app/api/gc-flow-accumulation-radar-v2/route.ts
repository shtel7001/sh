// @ts-nocheck
import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Keep the old scope so a browser already authenticated on V1 can reuse its token.
const SCOPE = 'gc-flow-accumulation-radar-20261002-v1';
const ACCESS_CODE_HASH = '696db21cbff09ada1a61dce8499bd5de35f5f8a7f68a90ac294e091a131ca70f';
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';
const CACHE_TTL = 10 * 60 * 1000;
const universeCache = new Map<string,{time:number,data:any[]}>();

function secret(){ return process.env.SESSION_SECRET || ''; }
function sign(payload:string){ return crypto.createHmac('sha256', `${secret()}:${SCOPE}`).update(payload).digest('base64url'); }
function createToken(){ const p=`${SCOPE}.${crypto.randomBytes(24).toString('base64url')}`; return `${p}.${sign(p)}`; }
function requestToken(req:Request){ return req.headers.get('x-auth-token') || (req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''); }
function validToken(token?:string|null){
  if(!token||!secret()) return false;
  const i=token.lastIndexOf('.'); if(i<0) return false;
  const p=token.slice(0,i),s=token.slice(i+1); if(!p.startsWith(`${SCOPE}.`)) return false;
  const e=sign(p); if(s.length!==e.length) return false;
  try{return crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e));}catch{return false;}
}
function validPassword(v:string){
  const actual=crypto.createHash('sha256').update(String(v||'').trim()).digest();
  try{return actual.length===32&&crypto.timingSafeEqual(actual,Buffer.from(ACCESS_CODE_HASH,'hex'));}catch{return false;}
}
function unauthorized(){return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers:{'Cache-Control':'no-store'}});}
function clamp(v:number,a:number,b:number){return Math.max(a,Math.min(b,v));}
function n(v:any){
  if(typeof v==='number')return Number.isFinite(v)?v:0;
  const s=String(v??'').replace(/,/g,'').replace(/[원주%배\s]/g,'').trim();
  if(!s||s==='-'||s==='--')return 0;
  const x=Number(s.replace(/^\((.*)\)$/,'-$1')); return Number.isFinite(x)?x:0;
}
function round(v:number,p=2){const m=10**p;return Math.round(v*m)/m;}
function ymd(v:any){return String(v??'').replace(/\D/g,'').slice(0,8);}
function dashDate(v:any){const s=ymd(v);return /^\d{8}$/.test(s)?s.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):String(v??'');}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

async function fetchRaw(url:string,timeoutMs=11000,accept='application/json,text/plain,*/*'){
  let last='';
  for(let attempt=0;attempt<3;attempt++){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);
    try{
      const isNew=url.includes('stock.naver.com');
      const r=await fetch(url,{signal:c.signal,cache:'no-store',redirect:'follow',headers:{
        'User-Agent':UA,'Accept':accept,'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.6',
        'Referer':isNew?'https://stock.naver.com/':'https://m.stock.naver.com/'
      }});
      if(!r.ok){last=`HTTP_${r.status}`; if(r.status===429||r.status>=500)await sleep(180*(attempt+1)); else break; continue;}
      return r;
    }catch(e:any){last=String(e?.message||e);await sleep(180*(attempt+1));}
    finally{clearTimeout(t);}
  }
  throw new Error(last||'FETCH_FAILED');
}
async function fetchJson(url:string,timeoutMs=11000){
  const r=await fetchRaw(url,timeoutMs);const tx=await r.text();
  try{return JSON.parse(tx);}catch{throw new Error('JSON_PARSE_FAILED');}
}

function normalizeMarket(v:any){const s=String(v||'').toUpperCase();if(s.includes('KOSDAQ')||s==='KQ'||s==='2')return 'KOSDAQ';if(s.includes('KOSPI')||s==='KS'||s==='1')return 'KOSPI';return 'UNKNOWN';}
function normalizeUniverse(x:any,market:string){
  const code=String(x?.itemCode??x?.itemcode??x?.stockCode??x?.code??'').match(/\d{6}/)?.[0]||'';
  const name=String(x?.stockName??x?.name??x?.itemName??x?.itemname??'').trim(); if(!code||!name)return null;
  return {code,name,market:normalizeMarket(x?.marketType??x?.market??x?.stockExchangeType?.name??market)!=='UNKNOWN'?normalizeMarket(x?.marketType??x?.market??x?.stockExchangeType?.name??market):market,currentPrice:n(x?.closePrice??x?.currentPrice??x?.nowVal??x?.price)||null,marketValue:n(x?.marketValue??x?.marketCap??x?.marketSum)||null};
}
function firstArray(j:any){
  if(Array.isArray(j))return j;
  for(const k of ['items','stocks','content','data','result']){if(Array.isArray(j?.[k]))return j[k];if(Array.isArray(j?.result?.[k]))return j.result[k];}
  return [];
}
async function fetchUniverseNew(market:'KOSPI'|'KOSDAQ'){
  const out:any[]=[],seen=new Set<string>();
  for(let page=0;page<30;page++){
    const url=`https://stock.naver.com/api/domestic/market/stock/default?tradeType=KRX&marketType=${market}&orderType=marketSum&startIdx=${page}&pageSize=100`;
    const rows=firstArray(await fetchJson(url,12000)); if(!rows.length)break; let added=0;
    for(const x of rows){const r=normalizeUniverse(x,market);if(r&&!seen.has(r.code)){seen.add(r.code);out.push(r);added++;}}
    if(!added||rows.length<100)break;
  }
  if(out.length<300)throw new Error(`NEW_${market}_UNIVERSE_SHORT_${out.length}`); return out;
}
async function fetchUniverseOld(market:'KOSPI'|'KOSDAQ'){
  const out:any[]=[],seen=new Set<string>();
  for(let page=1;page<=30;page++){
    const rows=firstArray(await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=100`,12000));if(!rows.length)break;let added=0;
    for(const x of rows){const r=normalizeUniverse(x,market);if(r&&!seen.has(r.code)){seen.add(r.code);out.push(r);added++;}}
    if(!added||rows.length<100)break;
  }
  if(out.length<300)throw new Error(`OLD_${market}_UNIVERSE_SHORT_${out.length}`);return out;
}
async function fetchUniverseMarket(market:'KOSPI'|'KOSDAQ'){
  const c=universeCache.get(market);if(c&&Date.now()-c.time<CACHE_TTL)return c.data;
  let data:any[]=[];try{data=await fetchUniverseNew(market);}catch{data=await fetchUniverseOld(market);}
  universeCache.set(market,{time:Date.now(),data});return data;
}
async function fetchUniverse(market:string){if(market==='KOSPI')return fetchUniverseMarket('KOSPI');if(market==='KOSDAQ')return fetchUniverseMarket('KOSDAQ');const [a,b]=await Promise.all([fetchUniverseMarket('KOSPI'),fetchUniverseMarket('KOSDAQ')]);return a.concat(b);}

type Bar={date:string;open:number;high:number;low:number;close:number;volume:number;ma5?:number|null;ma20?:number|null};
function sma(a:number[],w:number,i:number){if(i<w-1)return null;let s=0;for(let k=i-w+1;k<=i;k++)s+=a[k];return s/w;}
async function loadHistory(code:string,asOf:string,lookbackDays:number,gcLookback=45){
  // lookbackDays may be 10, 20, 30, 50, 60, 77...; internally fetch extra rows for MA20 and an old as-of date.
  const logical=clamp(Math.round(lookbackDays||120),10,420), gc=clamp(Math.round(gcLookback||45),5,240);
  const count=clamp(Math.ceil(Math.max(logical,gc)*2.35)+150,180,1200),end=ymd(asOf)||'99999999';
  const r=await fetchRaw(`https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(code)}&timeframe=day&count=${count}&requestType=0`,12000,'text/xml,text/plain,*/*');
  const xml=await r.text(),out:Bar[]=[];
  for(const m of xml.matchAll(/<item\s+data=["']([^"']+)["']/g)){
    const [date,o,h,l,c,v]=m[1].split('|'),close=Number(c); if(!/^\d{8}$/.test(date)||date>end||!Number.isFinite(close)||close<=0)continue;
    out.push({date,open:Number(o)||close,high:Number(h)||close,low:Number(l)||close,close,volume:Number(v)||0});
  }
  out.sort((a,b)=>a.date.localeCompare(b.date)); if(out.length<30)throw new Error(`HISTORY_SHORT_${out.length}`); return out;
}

type Trend={date:string;foreign:number;institution:number;individual:number;holdRatio:number;close:number;source:string};
function keyValue(o:any,hints:string[]){
  if(!o||typeof o!=='object')return undefined;
  const entries=Object.entries(o); for(const [k,v] of entries){const s=k.toLowerCase().replace(/[_\-]/g,'');if(hints.some(h=>s.includes(h)))return v;} return undefined;
}
function trendRow(x:any,source:string):Trend|null{
  const date=ymd(x?.bizdate??x?.localDate??x?.date??x?.tradeDate??x?.businessDay??keyValue(x,['bizdate','tradedate','localdate','date']));
  if(!/^\d{8}$/.test(date))return null;
  const foreign=x?.foreignerPureBuyQuant??x?.foreignPureBuyQuant??x?.foreignerNetBuyQuantity??x?.foreignNetBuy??x?.foreignPureBuy??x?.foreignValue??keyValue(x,['foreignerpurebuy','foreignpurebuy','foreignnetbuy','foreignvalue','frgnpurebuy','frgnnetbuy']);
  const institution=x?.organPureBuyQuant??x?.institutionPureBuyQuant??x?.institutionNetBuyQuantity??x?.organNetBuy??x?.institutionalValue??keyValue(x,['organpurebuy','institutionpurebuy','institutionnetbuy','organnnetbuy','institutionalvalue','orgpurebuy','orgnetbuy']);
  const individual=x?.individualPureBuyQuant??x?.personalPureBuyQuant??x?.individualNetBuyQuantity??x?.personalValue??keyValue(x,['individualpurebuy','personalpurebuy','individualnetbuy','personalvalue']);
  const hold=x?.foreignerHoldRatio??x?.foreignHoldRatio??x?.foreignRate??keyValue(x,['foreignerholdratio','foreignholdratio','foreignrate']);
  if(foreign===undefined&&institution===undefined)return null;
  return {date,foreign:n(foreign),institution:n(institution),individual:n(individual),holdRatio:n(hold),close:n(x?.closePrice??x?.close),source};
}
function collectArrays(v:any,depth=0,out:any[][]=[]){
  if(depth>4||v==null)return out;
  if(Array.isArray(v)){if(v.length&&typeof v[0]==='object')out.push(v);for(const x of v.slice(0,4))collectArrays(x,depth+1,out);return out;}
  if(typeof v==='object')for(const x of Object.values(v))collectArrays(x,depth+1,out);return out;
}
function extractTrendRows(j:any,source:string){
  const arrays=collectArrays(j);let best:Trend[]=[];
  for(const a of arrays){const rows=a.map(x=>trendRow(x,source)).filter(Boolean) as Trend[];if(rows.length>best.length)best=rows;}
  if(Array.isArray(j)){const rows=j.map(x=>trendRow(x,source)).filter(Boolean) as Trend[];if(rows.length>best.length)best=rows;}
  return best;
}
async function loadTrendNew(code:string,asOf:string,needDays:number){
  const target=ymd(asOf),pageSize=clamp(Math.max(80,needDays*3+30),80,200),all:Trend[]=[];
  const starts=[0,1,2,3,4,5,20,40,60,80,100];
  for(const startIdx of starts){
    const url=`https://stock.naver.com/api/domestic/detail/${encodeURIComponent(code)}/trend?tradeType=KRX&startIdx=${startIdx}&pageSize=${pageSize}`;
    const j=await fetchJson(url,12000),rows=extractTrendRows(j,'Naver stock.naver trend');
    let added=0;const seen=new Set(all.map(x=>x.date));for(const x of rows){if(!seen.has(x.date)){all.push(x);seen.add(x.date);added++;}}
    all.sort((a,b)=>b.date.localeCompare(a.date));
    const usable=all.filter(x=>!target||x.date<=target); if(usable.length>=needDays+2)return all;
    if(startIdx>0&&!added)break;
  }
  if(!all.length)throw new Error('TREND_NEW_EMPTY'); return all;
}
async function loadTrendMobile(code:string){
  const urls=[`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/trend`,`https://m.stock.naver.com/front-api/stock/domestic/trend?code=${encodeURIComponent(code)}`,`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/integration`];
  let all:Trend[]=[];for(const u of urls){try{const j=await fetchJson(u,10000),rows=extractTrendRows(j,'Naver mobile trend');all=all.concat(rows);}catch{}}
  return [...new Map(all.map(x=>[x.date,x])).values()].sort((a,b)=>b.date.localeCompare(a.date));
}
async function loadTrend(code:string,asOf:string,needDays:number){
  const target=ymd(asOf);let rows:Trend[]=[];let firstErr='';
  try{rows=await loadTrendNew(code,asOf,needDays);}catch(e:any){firstErr=String(e?.message||e);}
  if(rows.filter(x=>!target||x.date<=target).length<needDays){const m=await loadTrendMobile(code);rows=[...new Map(rows.concat(m).map(x=>[x.date,x])).values()].sort((a,b)=>b.date.localeCompare(a.date));}
  const usable=rows.filter(x=>!target||x.date<=target);if(usable.length<needDays)throw new Error(`TREND_RANGE_SHORT_${usable.length}_${firstErr||'NO_FALLBACK'}`);return rows;
}

function linearSlopePct(values:number[]){const len=values.length;if(len<2)return 0;const base=values[0]||1;let sx=0,sy=0,sxy=0,sxx=0;for(let i=0;i<len;i++){const y=(values[i]/base-1)*100;sx+=i;sy+=y;sxy+=i*y;sxx+=i*i;}const den=len*sxx-sx*sx;return den?(len*sxy-sx*sy)/den:0;}
type TechCfg={asOf:string;lookbackDays:number;gcLookback:number;minDaysAfterGc:number;minPostGcReturn:number;maxPostGcReturn:number;minSlopePerDay:number;maxSlopePerDay:number;maxDrawdown:number;maxRange:number;maxDist20:number;maxRecent5Rise:number;maxBelow20Days:number;requireMa5Above20:boolean;allowStrongTrend:boolean;strongMaxSlopePerDay:number;strongMaxDist20:number;strongMaxRecent5Rise:number;};
function analyseTechnical(rows:Bar[],cfg:TechCfg){
  const closes=rows.map(x=>x.close);for(let i=0;i<rows.length;i++){rows[i].ma5=sma(closes,5,i);rows[i].ma20=sma(closes,20,i);}
  const end=rows.length-1,searchDays=Math.min(cfg.gcLookback,cfg.lookbackDays),from=Math.max(20,end-searchDays);let gc=-1;
  for(let i=end;i>=from;i--){const a=rows[i],p=rows[i-1];if(a.ma5&&a.ma20&&p?.ma5&&p?.ma20&&a.ma5>a.ma20&&p.ma5<=p.ma20){gc=i;break;}}
  if(gc<0)return {pass:false,reason:'GC_NOT_FOUND',asOf:dashDate(rows[end]?.date),searchedDays:searchDays};
  const cur=rows[end],g=rows[gc],post=rows.slice(gc,end+1),daysAfter=end-gc,ret=(cur.close/g.close-1)*100,minLow=Math.min(...post.map(x=>x.low)),maxHigh=Math.max(...post.map(x=>x.high)),draw=(1-minLow/g.close)*100,range=(maxHigh-minLow)/g.close*100,slope=linearSlopePct(post.map(x=>x.close));
  const dist20=cur.ma20?((cur.close-cur.ma20)/cur.ma20*100):999,below20=post.filter(x=>x.ma20&&x.close<x.ma20).length,recent=rows.slice(Math.max(0,end-5),end+1),recent5Rise=recent.length>1?(cur.close/recent[0].close-1)*100:0;
  const checks={days:daysAfter>=cfg.minDaysAfterGc,ret:ret>=cfg.minPostGcReturn&&ret<=cfg.maxPostGcReturn,slope:slope>=cfg.minSlopePerDay&&slope<=cfg.maxSlopePerDay,draw:draw<=cfg.maxDrawdown,range:range<=cfg.maxRange,dist20:Math.abs(dist20)<=cfg.maxDist20,recent5:recent5Rise<=cfg.maxRecent5Rise,below20:below20<=cfg.maxBelow20Days,maOrder:!cfg.requireMa5Above20||Number(cur.ma5)>=Number(cur.ma20)};
  const strictPass=Object.values(checks).every(Boolean);
  const strongChecks={base:checks.days&&checks.ret&&checks.draw&&checks.range&&checks.below20&&checks.maOrder,slope:slope>=cfg.minSlopePerDay&&slope<=cfg.strongMaxSlopePerDay,dist20:Math.abs(dist20)<=cfg.strongMaxDist20,recent5:recent5Rise<=cfg.strongMaxRecent5Rise};
  const strongPass=!!cfg.allowStrongTrend&&!strictPass&&strongChecks.base&&strongChecks.slope&&strongChecks.dist20&&strongChecks.recent5;
  const pass=strictPass||strongPass;let score=0;if(checks.days)score+=8;if(checks.ret)score+=10;if(checks.slope)score+=10;if(checks.draw)score+=8;if(checks.range)score+=6;if(checks.dist20)score+=6;if(checks.recent5)score+=4;if(checks.below20)score+=4;if(checks.maOrder)score+=4;if(strongPass)score+=3;
  return {pass,strictPass,strongPass,priceMode:strictPass?'완만형':strongPass?'수급강화형':'미통과',score,checks,strongChecks,asOf:dashDate(cur.date),price:cur.close,gcDate:dashDate(g.date),gcPrice:g.close,daysAfterGc:daysAfter,postGcReturnPct:round(ret),slopePctPerDay:round(slope,3),maxDrawdownPct:round(draw),postGcRangePct:round(range),dist20Pct:round(dist20),recent5RisePct:round(recent5Rise),below20Days:below20,ma5:round(Number(cur.ma5)),ma20:round(Number(cur.ma20)),searchedDays:searchDays};
}

type FlowCfg={flowDays:number;minForeignDays:number;minInstDays:number;minCoverageDays:number;minJointDays:number;minCombinedVolumePct:number;allowForeignOnly:boolean;allowInstOnly:boolean;allowAlternate:boolean;};
function analyseFlow(trends:Trend[],rows:Bar[],cfg:FlowCfg,asOf:string){
  const target=ymd(asOf),usable=trends.filter(x=>!target||x.date<=target).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,cfg.flowDays);if(usable.length<cfg.flowDays)return null;
  const volumeByDate=new Map(rows.map(x=>[x.date,x.volume]));const r=usable.map(x=>({...x,volume:volumeByDate.get(x.date)||0})),fsum=r.reduce((s,x)=>s+x.foreign,0),isum=r.reduce((s,x)=>s+x.institution,0),csum=fsum+isum,vol=r.reduce((s,x)=>s+x.volume,0);
  const fDays=r.filter(x=>x.foreign>0).length,iDays=r.filter(x=>x.institution>0).length,joint=r.filter(x=>x.foreign>0&&x.institution>0).length,coverage=r.filter(x=>x.foreign>0||x.institution>0).length,alternate=r.filter(x=>(x.foreign>0&&x.institution<=0)||(x.institution>0&&x.foreign<=0)).length,combPct=vol?csum/vol*100:0;
  const first5=r.slice(0,Math.min(5,r.length)),prev5=r.slice(5,Math.min(10,r.length)),sum=(a:any[],k:string)=>a.reduce((z,x)=>z+Number(x[k]||0),0),recentAccel=(sum(first5,'foreign')+sum(first5,'institution'))-(sum(prev5,'foreign')+sum(prev5,'institution'));
  const foreignOnly=cfg.allowForeignOnly&&fsum>0&&fDays>=cfg.minForeignDays,instOnly=cfg.allowInstOnly&&isum>0&&iDays>=cfg.minInstDays,alternating=cfg.allowAlternate&&csum>0&&coverage>=cfg.minCoverageDays&&fDays>=1&&iDays>=1,pass=(foreignOnly||instOnly||alternating)&&joint>=cfg.minJointDays&&combPct>=cfg.minCombinedVolumePct;
  let score=0;score+=Math.min(12,Math.round(fDays/cfg.flowDays*14));score+=Math.min(12,Math.round(iDays/cfg.flowDays*14));score+=Math.min(12,Math.round(coverage/cfg.flowDays*14));score+=Math.min(8,joint*2);score+=combPct>0?Math.min(14,Math.round(combPct*8)):0;score+=recentAccel>0?6:0;
  return {pass,score,flowDate:dashDate(r[0].date),oldestFlowDate:dashDate(r[r.length-1].date),source:r[0].source,foreignSum:fsum,institutionSum:isum,combinedSum:csum,foreignPositiveDays:fDays,institutionPositiveDays:iDays,coverageDays:coverage,jointDays:joint,alternateDays:alternate,combinedVolumePct:round(combPct,3),recentAccel:round(recentAccel),mode:alternating?'교대매수':foreignOnly&&instOnly?'외인+기관 누적':foreignOnly?'외국인 누적':'기관 누적',recent:r.map(x=>({date:dashDate(x.date),foreign:x.foreign,institution:x.institution,combined:x.foreign+x.institution,holdRatio:x.holdRatio}))};
}
async function loadBasic(code:string){
  for(const u of [`https://stock.naver.com/api/domestic/detail/${code}/detail?codeType=KRX`,`https://m.stock.naver.com/api/stock/${code}/basic`]){try{const j=await fetchJson(u,9000);return {name:String(j?.stockName??j?.itemName??j?.name??''),market:normalizeMarket(j?.stockExchangeType?.name??j?.marketType??j?.market)};}catch{}}
  return {name:'',market:'UNKNOWN'};
}

async function health(code:string,asOf:string,lookback:number){
  try{
    const [rows,trends]=await Promise.all([loadHistory(code,asOf,lookback,Math.min(lookback,60)),loadTrend(code,asOf,15)]);const target=ymd(asOf),u=trends.filter(x=>x.date<=target).sort((a,b)=>b.date.localeCompare(a.date));
    return NextResponse.json({ok:true,code,asOf,historyRows:rows.length,lastPriceDate:dashDate(rows[rows.length-1]?.date),trendRows:trends.length,usableTrendRows:u.length,trendNewest:dashDate(u[0]?.date),trendOldest:dashDate(u[Math.min(14,u.length-1)]?.date),trendSource:u[0]?.source||null},{headers:{'Cache-Control':'no-store'}});
  }catch(e:any){return NextResponse.json({ok:false,code,asOf,error:String(e?.message||e)},{status:502,headers:{'Cache-Control':'no-store'}});}
}

async function diagnose(code:string,asOf:string,lookback:number){
  try{
    const techCfg:TechCfg={asOf,lookbackDays:lookback,gcLookback:45,minDaysAfterGc:3,minPostGcReturn:-3,maxPostGcReturn:35,minSlopePerDay:-0.15,maxSlopePerDay:1.5,maxDrawdown:10,maxRange:35,maxDist20:12,maxRecent5Rise:15,maxBelow20Days:5,requireMa5Above20:true,allowStrongTrend:true,strongMaxSlopePerDay:2.5,strongMaxDist20:18,strongMaxRecent5Rise:22};
    const flowCfg:FlowCfg={flowDays:15,minForeignDays:5,minInstDays:5,minCoverageDays:9,minJointDays:0,minCombinedVolumePct:0,allowForeignOnly:true,allowInstOnly:true,allowAlternate:true};
    const [rows,trends]=await Promise.all([loadHistory(code,asOf,lookback,45),loadTrend(code,asOf,15)]);
    const tech=analyseTechnical(rows,techCfg),flow=analyseFlow(trends,rows,flowCfg,asOf);
    const failedChecks=tech?.checks?Object.entries(tech.checks).filter(([,v])=>!v).map(([k])=>k):[];
    return NextResponse.json({ok:true,code,requestedAsOf:asOf,actualPriceAsOf:tech?.asOf||dashDate(rows[rows.length-1]?.date),lookback,tech,failedChecks,flow},{headers:{'Cache-Control':'no-store'}});
  }catch(e:any){return NextResponse.json({ok:false,code,asOf,error:String(e?.message||e)},{status:502,headers:{'Cache-Control':'no-store'}});}
}

export async function GET(req:Request){
  const u=new URL(req.url),op=u.searchParams.get('op')||'';
  if(op==='health'){const code=String(u.searchParams.get('code')||'005930').replace(/\D/g,'').slice(0,6),asOf=String(u.searchParams.get('asOf')||'2026-09-01'),lookback=clamp(Number(u.searchParams.get('lookback')||60),10,420);return health(code,asOf,lookback);}
  if(op==='diagnose'){const code=String(u.searchParams.get('code')||'005930').replace(/\D/g,'').slice(0,6),asOf=String(u.searchParams.get('asOf')||'2026-09-01'),lookback=clamp(Number(u.searchParams.get('lookback')||60),10,420);return diagnose(code,asOf,lookback);}
  if(!validToken(requestToken(req)))return unauthorized();
  if(op==='universe'){try{const market=String(u.searchParams.get('market')||'ALL').toUpperCase();const rows=await fetchUniverse(market);return NextResponse.json({rows,count:rows.length,market},{headers:{'Cache-Control':'no-store'}});}catch(e:any){return NextResponse.json({error:'UNIVERSE_FAILED',message:String(e?.message||e)},{status:502});}}
  return NextResponse.json({error:'BAD_OP'},{status:400});
}

export async function POST(req:Request){
  const u=new URL(req.url),op=u.searchParams.get('op')||'',body:any=await req.json().catch(()=>({}));
  if(op==='login'){
    if(!process.env.SESSION_SECRET)return NextResponse.json({error:'AUTH_NOT_CONFIGURED'},{status:503});
    if(!validPassword(String(body?.code||body?.password||'')))return NextResponse.json({error:'INVALID_CODE'},{status:401});
    return NextResponse.json({ok:true,token:createToken()},{headers:{'Cache-Control':'no-store'}});
  }
  if(!validToken(requestToken(req)))return unauthorized();
  if(op==='technical'){
    const stocks=Array.isArray(body.stocks)?body.stocks.slice(0,24):[];if(!stocks.length)return NextResponse.json({error:'NO_STOCKS'},{status:400});const b=body.cfg||{};
    const cfg:TechCfg={asOf:String(b.asOf||''),lookbackDays:clamp(Number(b.lookbackDays??120),10,420),gcLookback:clamp(Number(b.gcLookback??45),5,240),minDaysAfterGc:clamp(Number(b.minDaysAfterGc??3),0,100),minPostGcReturn:clamp(Number(b.minPostGcReturn??-3),-30,50),maxPostGcReturn:clamp(Number(b.maxPostGcReturn??35),0,200),minSlopePerDay:clamp(Number(b.minSlopePerDay??-0.15),-5,5),maxSlopePerDay:clamp(Number(b.maxSlopePerDay??1.5),0,10),maxDrawdown:clamp(Number(b.maxDrawdown??10),0,50),maxRange:clamp(Number(b.maxRange??35),1,150),maxDist20:clamp(Number(b.maxDist20??12),1,50),maxRecent5Rise:clamp(Number(b.maxRecent5Rise??15),0,100),maxBelow20Days:clamp(Number(b.maxBelow20Days??5),0,100),requireMa5Above20:b.requireMa5Above20!==false,allowStrongTrend:b.allowStrongTrend!==false,strongMaxSlopePerDay:clamp(Number(b.strongMaxSlopePerDay??2.5),0,10),strongMaxDist20:clamp(Number(b.strongMaxDist20??18),1,50),strongMaxRecent5Rise:clamp(Number(b.strongMaxRecent5Rise??22),0,100)};
    if(!/^\d{4}-\d{2}-\d{2}$/.test(cfg.asOf))return NextResponse.json({error:'BAD_DATE'},{status:400});const results:any[]=[],errors:any[]=[];
    for(let i=0;i<stocks.length;i+=6){const rr=await Promise.all(stocks.slice(i,i+6).map(async(s:any)=>{const code=String(s?.code||'').replace(/\D/g,'').slice(0,6);try{const rows=await loadHistory(code,cfg.asOf,cfg.lookbackDays,cfg.gcLookback);return {...s,code,tech:analyseTechnical(rows,cfg)};}catch(e:any){return {...s,code,scanError:String(e?.message||e)};}}));for(const r of rr){if(r.scanError)errors.push(r);else results.push(r);}}
    return NextResponse.json({results,errors,count:results.length},{headers:{'Cache-Control':'no-store'}});
  }
  if(op==='flowRange'){
    const stocks=Array.isArray(body.stocks)?body.stocks.slice(0,10):[];if(!stocks.length)return NextResponse.json({error:'NO_STOCKS'},{status:400});
    const b=body.cfg||{},startDate=String(b.startDate||''),endDate=String(b.endDate||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||startDate>endDate)return NextResponse.json({error:'BAD_DATE_RANGE'},{status:400});
    const calDays=Math.max(1,Math.round((Date.parse(endDate+'T00:00:00Z')-Date.parse(startDate+'T00:00:00Z'))/86400000)+1);
    const expectedTrading=clamp(Math.ceil(calDays*0.70)+8,5,300),historyLookback=clamp(calDays+45,30,420);
    const baseCfg={minForeignDays:clamp(Number(b.minForeignDays??5),0,300),minInstDays:clamp(Number(b.minInstDays??5),0,300),minCoverageDays:clamp(Number(b.minCoverageDays??9),0,300),minJointDays:clamp(Number(b.minJointDays??0),0,300),minCombinedVolumePct:clamp(Number(b.minCombinedVolumePct??0),-10,20),allowForeignOnly:b.allowForeignOnly!==false,allowInstOnly:b.allowInstOnly!==false,allowAlternate:b.allowAlternate!==false};
    const sy=ymd(startDate),ey=ymd(endDate),results:any[]=[],errors:any[]=[];
    for(let i=0;i<stocks.length;i+=3){
      const rr=await Promise.all(stocks.slice(i,i+3).map(async(s:any)=>{
        const code=String(s?.code||'').replace(/\D/g,'').slice(0,6);
        try{
          const [rows,basic]=await Promise.all([loadHistory(code,endDate,historyLookback,45),loadBasic(code)]);
          let trends:Trend[]=[];
          try{trends=await loadTrendNew(code,endDate,expectedTrading);}catch{}
          if(!trends.length){try{trends=await loadTrendMobile(code);}catch{}}
          trends=[...new Map(trends.map(x=>[x.date,x])).values()].sort((a,b)=>b.date.localeCompare(a.date));
          const oldest=trends[trends.length-1]?.date||'';
          if(!trends.length)throw new Error('TREND_EMPTY');
          if(oldest>sy)throw new Error('TREND_RANGE_INCOMPLETE_'+dashDate(oldest));
          const inRange=trends.filter(x=>x.date>=sy&&x.date<=ey).sort((a,b)=>b.date.localeCompare(a.date));
          if(!inRange.length)throw new Error('FLOW_RANGE_EMPTY');
          const cfg:FlowCfg={flowDays:inRange.length,minForeignDays:baseCfg.minForeignDays,minInstDays:baseCfg.minInstDays,minCoverageDays:baseCfg.minCoverageDays,minJointDays:baseCfg.minJointDays,minCombinedVolumePct:baseCfg.minCombinedVolumePct,allowForeignOnly:baseCfg.allowForeignOnly,allowInstOnly:baseCfg.allowInstOnly,allowAlternate:baseCfg.allowAlternate};
          const flow=analyseFlow(inRange,rows,cfg,endDate);if(!flow)throw new Error('FLOW_EMPTY');
          return {...s,code,name:s.name||basic.name||code,market:s.market&&s.market!=='UNKNOWN'?s.market:basic.market,rangeStart:startDate,rangeEnd:endDate,tradingDays:inRange.length,flow,totalScore:flow.score,pass:flow.pass,naver:`https://stock.naver.com/domestic/stock/${code}/price`,investor:`https://stock.naver.com/domestic/stock/${code}/investmentinfo`,news:`https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(String(s.name||basic.name||code))}`};
        }catch(e:any){return {...s,code,scanError:String(e?.message||e)};}
      }));
      for(const r of rr){if(r.scanError)errors.push(r);else results.push(r);}
    }
    results.sort((a,b)=>Number(b.totalScore||0)-Number(a.totalScore||0));
    return NextResponse.json({results,errors,count:results.length,startDate,endDate},{headers:{'Cache-Control':'no-store'}});
  }
  if(op==='flow'){
    const stocks=Array.isArray(body.stocks)?body.stocks.slice(0,10):[];if(!stocks.length)return NextResponse.json({error:'NO_STOCKS'},{status:400});const b=body.cfg||{},asOf=String(b.asOf||''),lookbackDays=clamp(Number(b.lookbackDays??120),10,420);
    const cfg:FlowCfg={flowDays:clamp(Number(b.flowDays??15),3,40),minForeignDays:clamp(Number(b.minForeignDays??5),1,40),minInstDays:clamp(Number(b.minInstDays??5),1,40),minCoverageDays:clamp(Number(b.minCoverageDays??9),1,40),minJointDays:clamp(Number(b.minJointDays??0),0,40),minCombinedVolumePct:clamp(Number(b.minCombinedVolumePct??0),-10,20),allowForeignOnly:b.allowForeignOnly!==false,allowInstOnly:b.allowInstOnly!==false,allowAlternate:b.allowAlternate!==false};
    const results:any[]=[],errors:any[]=[];
    for(let i=0;i<stocks.length;i+=3){const rr=await Promise.all(stocks.slice(i,i+3).map(async(s:any)=>{const code=String(s?.code||'').replace(/\D/g,'').slice(0,6);try{const [rows,trends,basic]=await Promise.all([loadHistory(code,asOf,lookbackDays,45),loadTrend(code,asOf,cfg.flowDays),loadBasic(code)]);const flow=analyseFlow(trends,rows,cfg,asOf);if(!flow)throw new Error('FLOW_EMPTY');const tech=s.tech||{},total=Number(tech.score||0)+flow.score;return {...s,code,name:s.name||basic.name||code,market:s.market&&s.market!=='UNKNOWN'?s.market:basic.market,flow,totalScore:total,pass:!!tech.pass&&flow.pass,naver:`https://stock.naver.com/domestic/stock/${code}/price`,investor:`https://stock.naver.com/domestic/stock/${code}/investmentinfo`,news:`https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(String(s.name||basic.name||code))}`};}catch(e:any){return {...s,code,scanError:String(e?.message||e)};}}));for(const r of rr){if(r.scanError)errors.push(r);else results.push(r);}}
    results.sort((a,b)=>Number(b.totalScore||0)-Number(a.totalScore||0));return NextResponse.json({results,errors,count:results.length},{headers:{'Cache-Control':'no-store'}});
  }
  return NextResponse.json({error:'BAD_OP'},{status:400});
}
