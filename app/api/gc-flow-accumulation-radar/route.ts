import { NextResponse } from 'next/server';
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  const p=token.slice(0,i), s=token.slice(i+1); if(!p.startsWith(`${SCOPE}.`)) return false;
  const e=sign(p); if(s.length!==e.length) return false;
  try{return crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e));}catch{return false;}
}
function validPassword(v:string){
  if(!secret()) return false;
  const actual=crypto.createHash('sha256').update(String(v||'').trim()).digest();
  try{return crypto.timingSafeEqual(actual,Buffer.from(ACCESS_CODE_HASH,'hex'));}catch{return false;}
}
function unauthorized(){ return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers:{'Cache-Control':'no-store'}}); }
function n(v:any){ if(typeof v==='number') return Number.isFinite(v)?v:0; const x=Number(String(v??'').replace(/[,%+원주\s]/g,'')); return Number.isFinite(x)?x:0; }
function round(v:number,p=2){const m=10**p;return Math.round(v*m)/m;}
function clamp(v:number,a:number,b:number){return Math.max(a,Math.min(b,v));}
function ymd(v:any){return String(v??'').replace(/\D/g,'').slice(0,8);}
function dashDate(v:any){const s=ymd(v);return /^\d{8}$/.test(s)?s.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):String(v??'');}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

async function fetchRaw(url:string,timeoutMs=10000,accept='application/json,text/plain,*/*'){
  let last='';
  for(let attempt=0;attempt<3;attempt++){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);
    try{
      const r=await fetch(url,{signal:c.signal,cache:'no-store',headers:{'User-Agent':UA,'Accept':accept,'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.6','Referer':url.includes('finance.naver.com')?'https://finance.naver.com/':'https://m.stock.naver.com/'}});
      if(!r.ok){last=`HTTP ${r.status}`;await sleep(140*(attempt+1));continue;}
      return r;
    }catch(e:any){last=String(e?.message||e);await sleep(140*(attempt+1));}
    finally{clearTimeout(t);}
  }
  throw new Error(last||'FETCH_FAILED');
}
async function fetchJson(url:string,timeoutMs=10000){const r=await fetchRaw(url,timeoutMs);const tx=await r.text();try{return JSON.parse(tx);}catch{throw new Error('JSON_PARSE_FAILED');}}
async function fetchHtml(url:string,timeoutMs=10000){const r=await fetchRaw(url,timeoutMs,'text/html,application/xhtml+xml,*/*');const b=Buffer.from(await r.arrayBuffer()),ct=(r.headers.get('content-type')||'').toLowerCase();return ct.includes('utf-8')?b.toString('utf8'):iconv.decode(b,'EUC-KR');}
function pickArray(j:any,keys:string[]=['stocks','items','data','result']){if(Array.isArray(j))return j;for(const k of keys){if(Array.isArray(j?.[k]))return j[k];if(Array.isArray(j?.result?.[k]))return j.result[k];}if(Array.isArray(j?.result))return j.result;return [];}
function normalizeMarket(v:any){const s=String(v||'').toUpperCase();if(s.includes('KOSDAQ')||s==='KQ'||s==='2')return 'KOSDAQ';if(s.includes('KOSPI')||s==='KS'||s==='1')return 'KOSPI';return 'UNKNOWN';}

function normalizeUniverse(x:any,market:string){
  const code=String(x?.itemCode??x?.itemcode??x?.stockCode??x?.code??'').match(/\d{6}/)?.[0]||'';
  const name=String(x?.stockName??x?.name??x?.itemName??'').trim();
  if(!code||!name)return null;
  return {code,name,market,currentPrice:n(x?.closePrice??x?.currentPrice??x?.nowVal??x?.price)||null,changePct:n(x?.fluctuationsRatio??x?.changeRate??x?.changePct??x?.rate),marketValue:n(x?.marketValue??x?.marketCap)||null};
}
async function fetchUniverseMarket(market:'KOSPI'|'KOSDAQ'){
  const c=universeCache.get(market);if(c&&Date.now()-c.time<CACHE_TTL)return c.data;
  const out:any[]=[],seen=new Set<string>();
  for(let page=1;page<=30;page++){
    const j=await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=100`,10000);
    const rows=pickArray(j);if(!rows.length)break;let added=0;
    for(const x of rows){const r=normalizeUniverse(x,market);if(r&&!seen.has(r.code)){seen.add(r.code);out.push(r);added++;}}
    if(!added||rows.length<100)break;
  }
  if(out.length<300)throw new Error(`${market}_UNIVERSE_SHORT_${out.length}`);
  universeCache.set(market,{time:Date.now(),data:out});return out;
}
async function fetchUniverse(market:string){
  if(market==='KOSPI')return fetchUniverseMarket('KOSPI');
  if(market==='KOSDAQ')return fetchUniverseMarket('KOSDAQ');
  const [a,b]=await Promise.all([fetchUniverseMarket('KOSPI'),fetchUniverseMarket('KOSDAQ')]);return a.concat(b);
}

type Bar={date:string;open:number;high:number;low:number;close:number;volume:number;ma5?:number|null;ma20?:number|null};
function sma(a:number[],w:number,i:number){if(i<w-1)return null;let s=0;for(let k=i-w+1;k<=i;k++)s+=a[k];return s/w;}
async function loadHistory(code:string,asOf:string,lookbackDays:number){
  const count=clamp(Math.ceil(lookbackDays*2.2)+90,180,900),end=ymd(asOf)||'99999999';
  const r=await fetchRaw(`https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(code)}&timeframe=day&count=${count}&requestType=0`,12000,'text/xml,text/plain,*/*');
  const xml=await r.text(),out:Bar[]=[];
  for(const m of xml.matchAll(/<item\s+data=["']([^"']+)["']/g)){
    const [date,o,h,l,c,v]=m[1].split('|'),close=Number(c);
    if(!/^\d{8}$/.test(date)||date>end||!Number.isFinite(close)||close<=0)continue;
    out.push({date,open:Number(o)||close,high:Number(h)||close,low:Number(l)||close,close,volume:Number(v)||0});
  }
  out.sort((a,b)=>a.date.localeCompare(b.date));if(out.length<35)throw new Error('HISTORY_SHORT');return out;
}

type Trend={date:string;foreign:number;institution:number;individual:number;holdRatio:number;close:number;source:string};
function trendRow(x:any,source:string):Trend|null{
  const date=ymd(x?.localDate??x?.date??x?.tradeDate??x?.bizdate??x?.['날짜']??x?.['일자']);if(!/^\d{8}$/.test(date))return null;
  return {date,foreign:n(x?.foreignerPureBuyQuant??x?.foreignPureBuyQuant??x?.foreignerNetBuyQuantity??x?.foreignNetBuy??x?.['외국인 순매매량']??x?.['외국인']),institution:n(x?.organPureBuyQuant??x?.institutionPureBuyQuant??x?.institutionNetBuyQuantity??x?.organNetBuy??x?.['기관 순매매량']??x?.['기관']),individual:n(x?.individualPureBuyQuant??x?.personalPureBuyQuant??x?.individualNetBuyQuantity??x?.['개인 순매매량']??x?.['개인']),holdRatio:n(x?.foreignerHoldRatio??x?.foreignHoldRatio??x?.['외국인 보유율']??x?.['보유율']),close:n(x?.closePrice??x?.close??x?.['종가']),source};
}
async function loadTrendMobile(code:string){
  const urls=[`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/trend`,`https://m.stock.naver.com/front-api/stock/domestic/trend?code=${encodeURIComponent(code)}`];let last='';
  for(const url of urls){try{const j=await fetchJson(url,10000),rows=pickArray(j,['dealTrendInfos','trendInfos','items','data']);const out=rows.map((x:any)=>trendRow(x,'Naver mobile trend')).filter(Boolean) as Trend[];if(out.length){out.sort((a,b)=>b.date.localeCompare(a.date));return out;}}catch(e:any){last=String(e?.message||e);}}
  throw new Error(last||'TREND_MOBILE_EMPTY');
}
async function loadTrendLegacy(code:string,asOf:string,needDays:number){
  const target=ymd(asOf),out:Trend[]=[];let covered=false;
  const pages=clamp(Math.ceil((needDays+15)/20),2,12);
  for(let page=1;page<=pages;page++){
    const html=await fetchHtml(`https://finance.naver.com/item/frgn.naver?code=${encodeURIComponent(code)}&page=${page}`,10000),$=cheerio.load(html);let rows=0,oldest='99999999';
    $('table.type2 tr').each((_,tr)=>{const cells=$(tr).find('td').map((_,td)=>$(td).text().replace(/\s+/g,' ').trim()).get();if(cells.length<7)return;const date=ymd(cells[0]);if(!/^\d{8}$/.test(date))return;rows++;if(date<oldest)oldest=date;out.push({date,close:n(cells[1]),institution:n(cells[5]),foreign:n(cells[6]),individual:0,holdRatio:n(cells[8]||0),source:'Naver PC investor'});});
    if(!rows)break;if(target&&oldest<=target){covered=true;if(out.filter(x=>x.date<=target).length>=needDays+5)break;}
  }
  const uniq=[...new Map(out.map(x=>[x.date,x])).values()].sort((a,b)=>b.date.localeCompare(a.date));if(!uniq.length)throw new Error('TREND_LEGACY_EMPTY');if(target&&!covered&&uniq[uniq.length-1].date>target)throw new Error('TREND_TARGET_OUT_OF_RANGE');return uniq;
}
async function loadTrend(code:string,asOf:string,needDays:number){const target=ymd(asOf);try{const rows=await loadTrendMobile(code),oldest=rows[rows.length-1]?.date||'',latest=rows[0]?.date||'';if((!target||(target<=latest&&target>=oldest)||target>latest)&&rows.filter(x=>!target||x.date<=target).length>=Math.min(needDays,5))return rows;}catch{}return loadTrendLegacy(code,asOf,needDays);}

function linearSlopePct(values:number[]){
  const n=values.length;if(n<2)return 0;const base=values[0]||1;let sx=0,sy=0,sxy=0,sxx=0;
  for(let i=0;i<n;i++){const y=(values[i]/base-1)*100;sx+=i;sy+=y;sxy+=i*y;sxx+=i*i;}
  const den=n*sxx-sx*sx;return den?(n*sxy-sx*sy)/den:0;
}

type TechCfg={asOf:string;lookbackDays:number;gcLookback:number;minDaysAfterGc:number;minPostGcReturn:number;maxPostGcReturn:number;minSlopePerDay:number;maxSlopePerDay:number;maxDrawdown:number;maxRange:number;maxDist20:number;maxRecent5Rise:number;maxBelow20Days:number;requireMa5Above20:boolean;};
function analyseTechnical(rows:Bar[],cfg:TechCfg){
  const closes=rows.map(x=>x.close);for(let i=0;i<rows.length;i++){rows[i].ma5=sma(closes,5,i);rows[i].ma20=sma(closes,20,i);}
  const end=rows.length-1;let gc=-1;
  for(let i=end;i>=Math.max(20,end-cfg.gcLookback);i--){const a=rows[i],p=rows[i-1];if(a.ma5&&a.ma20&&p?.ma5&&p?.ma20&&a.ma5>a.ma20&&p.ma5<=p.ma20){gc=i;break;}}
  if(gc<0)return {pass:false,reason:'GC_NOT_FOUND'};
  const cur=rows[end],g=rows[gc],post=rows.slice(gc,end+1),daysAfter=end-gc;
  const ret=(cur.close/g.close-1)*100,minLow=Math.min(...post.map(x=>x.low)),maxHigh=Math.max(...post.map(x=>x.high)),draw=(1-minLow/g.close)*100,range=(maxHigh-minLow)/g.close*100,slope=linearSlopePct(post.map(x=>x.close));
  const dist20=cur.ma20?((cur.close-cur.ma20)/cur.ma20*100):999;
  const below20=post.filter(x=>x.ma20&&x.close<x.ma20).length;
  const recent5=rows.slice(Math.max(0,end-5),end+1),recent5Rise=recent5.length>1?(cur.close/recent5[0].close-1)*100:0;
  const checks={days:daysAfter>=cfg.minDaysAfterGc,ret:ret>=cfg.minPostGcReturn&&ret<=cfg.maxPostGcReturn,slope:slope>=cfg.minSlopePerDay&&slope<=cfg.maxSlopePerDay,draw:draw<=cfg.maxDrawdown,range:range<=cfg.maxRange,dist20:Math.abs(dist20)<=cfg.maxDist20,recent5:recent5Rise<=cfg.maxRecent5Rise,below20:below20<=cfg.maxBelow20Days,maOrder:!cfg.requireMa5Above20||Number(cur.ma5)>=Number(cur.ma20)};
  const pass=Object.values(checks).every(Boolean);
  let score=0;if(checks.days)score+=8;if(checks.ret)score+=10;if(checks.slope)score+=10;if(checks.draw)score+=8;if(checks.range)score+=6;if(checks.dist20)score+=6;if(checks.recent5)score+=4;if(checks.below20)score+=4;if(checks.maOrder)score+=4;
  return {pass,score,checks,asOf:dashDate(cur.date),price:cur.close,gcDate:dashDate(g.date),gcPrice:g.close,daysAfterGc:daysAfter,postGcReturnPct:round(ret),slopePctPerDay:round(slope,3),maxDrawdownPct:round(draw),postGcRangePct:round(range),dist20Pct:round(dist20),recent5RisePct:round(recent5Rise),below20Days:below20,ma5:round(Number(cur.ma5)),ma20:round(Number(cur.ma20)),avg20Volume:round(rows.slice(Math.max(0,end-19),end+1).reduce((s,x)=>s+x.volume,0)/Math.min(20,end+1))};
}

type FlowCfg={flowDays:number;minForeignDays:number;minInstDays:number;minCoverageDays:number;minJointDays:number;minCombinedVolumePct:number;allowForeignOnly:boolean;allowInstOnly:boolean;allowAlternate:boolean;};
function analyseFlow(trends:Trend[],rows:Bar[],cfg:FlowCfg,asOf:string){
  const target=ymd(asOf),usable=trends.filter(x=>!target||x.date<=target).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,cfg.flowDays);if(!usable.length)return null;
  const volumeByDate=new Map(rows.map(x=>[x.date,x.volume]));const r=usable.map(x=>({...x,volume:volumeByDate.get(x.date)||0}));
  const fsum=r.reduce((s,x)=>s+x.foreign,0),isum=r.reduce((s,x)=>s+x.institution,0),csum=fsum+isum,vol=r.reduce((s,x)=>s+x.volume,0);
  const fDays=r.filter(x=>x.foreign>0).length,iDays=r.filter(x=>x.institution>0).length,joint=r.filter(x=>x.foreign>0&&x.institution>0).length,coverage=r.filter(x=>x.foreign>0||x.institution>0).length,alternate=r.filter(x=>(x.foreign>0&&x.institution<=0)||(x.institution>0&&x.foreign<=0)).length;
  const combPositive=r.filter(x=>x.foreign+x.institution>0).length,combPct=vol?csum/vol*100:0;
  const first5=r.slice(0,Math.min(5,r.length)),prev5=r.slice(5,Math.min(10,r.length));const s=(a:any[],k:'foreign'|'institution')=>a.reduce((z,x)=>z+x[k],0);const recentAccel=(s(first5,'foreign')+s(first5,'institution'))-(s(prev5,'foreign')+s(prev5,'institution'));
  const foreignOnly=cfg.allowForeignOnly&&fsum>0&&fDays>=cfg.minForeignDays;
  const instOnly=cfg.allowInstOnly&&isum>0&&iDays>=cfg.minInstDays;
  const alternating=cfg.allowAlternate&&csum>0&&coverage>=cfg.minCoverageDays&&fDays>=1&&iDays>=1;
  const basePass=(foreignOnly||instOnly||alternating)&&joint>=cfg.minJointDays&&combPct>=cfg.minCombinedVolumePct;
  let score=0;score+=Math.min(12,Math.round(fDays/cfg.flowDays*14));score+=Math.min(12,Math.round(iDays/cfg.flowDays*14));score+=Math.min(12,Math.round(coverage/cfg.flowDays*14));score+=Math.min(8,joint*2);score+=combPct>0?Math.min(14,Math.round(combPct*8)):0;score+=recentAccel>0?6:0;
  return {pass:basePass,score,flowDate:dashDate(r[0].date),foreignSum:fsum,institutionSum:isum,combinedSum:csum,foreignPositiveDays:fDays,institutionPositiveDays:iDays,coverageDays:coverage,jointDays:joint,alternateDays:alternate,combinedPositiveDays:combPositive,combinedVolumePct:round(combPct,3),recentAccel:round(recentAccel),mode:alternating?'교대매수':foreignOnly&&instOnly?'외인+기관 누적':foreignOnly?'외국인 누적':'기관 누적',recent:r.map(x=>({date:dashDate(x.date),foreign:x.foreign,institution:x.institution,combined:x.foreign+x.institution,holdRatio:x.holdRatio}))};
}

async function loadBasic(code:string){for(const u of [`https://m.stock.naver.com/api/stock/${code}/basic`,`https://m.stock.naver.com/front-api/stock/domestic/basic?code=${code}&endType=stock`]){try{const j=await fetchJson(u,8000);return {name:String(j?.stockName??j?.itemName??''),market:normalizeMarket(j?.stockExchangeType?.name??j?.stockExchangeType??j?.marketType)};}catch{}}return {name:'',market:'UNKNOWN'};}

export async function GET(req:Request){
  const u=new URL(req.url),op=u.searchParams.get('op')||'';if(!validToken(requestToken(req)))return unauthorized();
  if(op==='universe'){
    try{const market=String(u.searchParams.get('market')||'ALL').toUpperCase();const rows=await fetchUniverse(market);return NextResponse.json({rows,count:rows.length,market},{headers:{'Cache-Control':'no-store'}});}catch(e:any){return NextResponse.json({error:'UNIVERSE_FAILED',message:String(e?.message||e)},{status:502});}
  }
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
    const stocks=Array.isArray(body.stocks)?body.stocks.slice(0,28):[];if(!stocks.length)return NextResponse.json({error:'NO_STOCKS'},{status:400});
    const b=body.cfg||{};const cfg:TechCfg={asOf:String(b.asOf||''),lookbackDays:clamp(Number(b.lookbackDays??180),90,420),gcLookback:clamp(Number(b.gcLookback??45),5,180),minDaysAfterGc:clamp(Number(b.minDaysAfterGc??3),0,100),minPostGcReturn:clamp(Number(b.minPostGcReturn??-3),-30,50),maxPostGcReturn:clamp(Number(b.maxPostGcReturn??35),0,200),minSlopePerDay:clamp(Number(b.minSlopePerDay??-0.15),-5,5),maxSlopePerDay:clamp(Number(b.maxSlopePerDay??1.5),0,10),maxDrawdown:clamp(Number(b.maxDrawdown??10),0,50),maxRange:clamp(Number(b.maxRange??35),1,150),maxDist20:clamp(Number(b.maxDist20??12),1,50),maxRecent5Rise:clamp(Number(b.maxRecent5Rise??15),0,100),maxBelow20Days:clamp(Number(b.maxBelow20Days??5),0,100),requireMa5Above20:b.requireMa5Above20!==false};
    if(!/^\d{4}-\d{2}-\d{2}$/.test(cfg.asOf))return NextResponse.json({error:'BAD_DATE'},{status:400});
    const results:any[]=[],errors:any[]=[];
    for(let i=0;i<stocks.length;i+=7){const rr=await Promise.all(stocks.slice(i,i+7).map(async(s:any)=>{const code=String(s?.code||'').replace(/\D/g,'').slice(0,6);try{const rows=await loadHistory(code,cfg.asOf,cfg.lookbackDays);const tech=analyseTechnical(rows,cfg);return {...s,code,tech};}catch(e:any){return {...s,code,scanError:String(e?.message||e)};}}));for(const r of rr){if(r.scanError)errors.push(r);else results.push(r);}}
    return NextResponse.json({results,errors,count:results.length},{headers:{'Cache-Control':'no-store'}});
  }
  if(op==='flow'){
    const stocks=Array.isArray(body.stocks)?body.stocks.slice(0,12):[];if(!stocks.length)return NextResponse.json({error:'NO_STOCKS'},{status:400});
    const b=body.cfg||{};const asOf=String(b.asOf||'');const lookbackDays=clamp(Number(b.lookbackDays??180),90,420);const cfg:FlowCfg={flowDays:clamp(Number(b.flowDays??15),3,40),minForeignDays:clamp(Number(b.minForeignDays??5),1,40),minInstDays:clamp(Number(b.minInstDays??5),1,40),minCoverageDays:clamp(Number(b.minCoverageDays??9),1,40),minJointDays:clamp(Number(b.minJointDays??0),0,40),minCombinedVolumePct:clamp(Number(b.minCombinedVolumePct??0),-10,20),allowForeignOnly:b.allowForeignOnly!==false,allowInstOnly:b.allowInstOnly!==false,allowAlternate:b.allowAlternate!==false};
    const results:any[]=[],errors:any[]=[];
    for(let i=0;i<stocks.length;i+=4){const rr=await Promise.all(stocks.slice(i,i+4).map(async(s:any)=>{const code=String(s?.code||'').replace(/\D/g,'').slice(0,6);try{const [rows,trends,basic]=await Promise.all([loadHistory(code,asOf,lookbackDays),loadTrend(code,asOf,cfg.flowDays),loadBasic(code)]);const flow=analyseFlow(trends,rows,cfg,asOf);if(!flow)throw new Error('FLOW_EMPTY');const tech=s.tech||{};const total=Number(tech.score||0)+flow.score;return {...s,code,name:s.name||basic.name||code,market:s.market&&s.market!=='UNKNOWN'?s.market:basic.market,flow,totalScore:total,pass:!!tech.pass&&flow.pass,naver:`https://finance.naver.com/item/main.naver?code=${code}`,investor:`https://finance.naver.com/item/frgn.naver?code=${code}`,news:`https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(String(s.name||basic.name||code))}`};}catch(e:any){return {...s,code,scanError:String(e?.message||e)};}}));for(const r of rr){if(r.scanError)errors.push(r);else results.push(r);}}
    results.sort((a,b)=>Number(b.totalScore||0)-Number(a.totalScore||0));return NextResponse.json({results,errors,count:results.length},{headers:{'Cache-Control':'no-store'}});
  }
  return NextResponse.json({error:'BAD_OP'},{status:400});
}
