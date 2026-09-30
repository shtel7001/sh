import { NextResponse } from 'next/server';
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const SCOPE='d1-theme-spike-radar-v1';
const ACCESS_CODE_HASH='f1ea5932a7301a0441b309d4c55ea2f4410b5b67a32fff2435d5aed762432c8e';
const themeCache={time:0,data:[] as any[]};
const memberCache=new Map<string,{time:number,data:any[]}>();
const CACHE_TTL=15*60*1000;

function secret(){return process.env.SESSION_SECRET||''}
function sign(payload:string){return crypto.createHmac('sha256',`${secret()}:${SCOPE}`).update(payload).digest('base64url')}
function createToken(){const p=`${SCOPE}.${crypto.randomBytes(24).toString('base64url')}`;return `${p}.${sign(p)}`}
function requestToken(req:Request){return req.headers.get('x-auth-token')||(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'')}
function validToken(token?:string|null){if(!token||!secret())return false;const i=token.lastIndexOf('.');if(i<0)return false;const p=token.slice(0,i),s=token.slice(i+1);if(!p.startsWith(`${SCOPE}.`))return false;const e=sign(p);if(s.length!==e.length)return false;try{return crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e))}catch{return false}}
function validPassword(v:string){if(!secret())return false;const actual=crypto.createHash('sha256').update(String(v||'')).digest();return actual.length===32&&crypto.timingSafeEqual(actual,Buffer.from(ACCESS_CODE_HASH,'hex'))}
function unauthorized(){return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers:{'Cache-Control':'no-store'}})}
function n(v:any){if(typeof v==='number')return Number.isFinite(v)?v:0;const x=Number(String(v??'').replace(/[,%+원\s]/g,''));return Number.isFinite(x)?x:0}
function round(v:number,p=2){const m=10**p;return Math.round(v*m)/m}
function clamp(v:number,a:number,b:number){return Math.max(a,Math.min(b,v))}
function ymd(s:string){return String(s||'').replace(/\D/g,'').slice(0,8)}
function dtext(v:string){return /^\d{8}$/.test(v)?v.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):v}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

async function fetchRaw(url:string,timeoutMs=10000,accept='application/json,text/plain,*/*'){
  let last='';
  for(let attempt=0;attempt<3;attempt++){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);
    try{
      const r=await fetch(url,{signal:c.signal,cache:'no-store',headers:{'User-Agent':'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36','Accept':accept,'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.6','Referer':url.includes('finance.naver.com')?'https://finance.naver.com/':'https://m.stock.naver.com/'}});
      if(!r.ok){last=`HTTP ${r.status}`;await sleep(180*(attempt+1));continue}
      return r;
    }catch(e:any){last=String(e?.message||e);await sleep(180*(attempt+1))}finally{clearTimeout(t)}
  }
  throw new Error(last||'FETCH_FAILED');
}
async function fetchJson(url:string,timeoutMs=10000){const r=await fetchRaw(url,timeoutMs);const tx=await r.text();try{return JSON.parse(tx)}catch{throw new Error('JSON_PARSE_FAILED')}}
async function fetchHtml(url:string,timeoutMs=10000){const r=await fetchRaw(url,timeoutMs,'text/html,application/xhtml+xml,*/*');const b=Buffer.from(await r.arrayBuffer()),ct=(r.headers.get('content-type')||'').toLowerCase();return ct.includes('utf-8')?b.toString('utf8'):iconv.decode(b,'EUC-KR')}
function pickArray(j:any,keys:string[]){if(Array.isArray(j))return j;for(const k of keys){if(Array.isArray(j?.[k]))return j[k];if(Array.isArray(j?.result?.[k]))return j.result[k]}if(Array.isArray(j?.result))return j.result;return []}
function normalizeMarket(v:any){const s=String(v||'').toUpperCase();if(s.includes('KOSDAQ')||s==='KQ'||s==='2')return 'KOSDAQ';if(s.includes('KOSPI')||s==='KS'||s==='1')return 'KOSPI';return 'UNKNOWN'}

function normalizeTheme(x:any){
  const code=String(x?.code??x?.sectorCode??x?.detailNo??x?.no??'').replace(/\D/g,'');
  const name=String(x?.name??x?.sectorName??x?.themeName??'').trim();
  if(!code||!name)return null;
  const up=n(x?.risingCount??x?.risingStockCount??x?.riseCount??x?.upCount),down=n(x?.fallingCount??x?.fallingStockCount??x?.fallCount??x?.downCount),flat=n(x?.unchangedCount??x?.unchangedStockCount??x?.steadyCount??x?.flatCount);
  return {code,name,changePct:n(x?.changeRate??x?.fluctuationsRatio??x?.changePct??x?.rate),up,down,flat,count:n(x?.stockCount??x?.itemCount??x?.totalCount)||(up+down+flat),source:'Naver front-api'};
}

async function loadThemesFront(){
  const out:any[]=[];let cursor='';const seenCursors=new Set<string>();
  for(let turn=0;turn<12;turn++){
    const base='https://m.stock.naver.com/front-api/stock/sectors/all?nationType=domestic&sectorType=theme&sectorSortType=CHANGE_RATE&businessDayCategory=daily&pageSize=50';
    const url=cursor?`${base}&cursor=${encodeURIComponent(cursor)}`:base;
    const j=await fetchJson(url,10000),rows=pickArray(j,['sectors','items','stocks','data']);
    if(!rows.length)break;
    for(const x of rows){const t=normalizeTheme(x);if(t)out.push(t)}
    const next=String(j?.result?.cursor||'');
    if(j?.result?.hasNext===false||!next||next===cursor||seenCursors.has(next))break;
    seenCursors.add(next);cursor=next;
  }
  const uniq=[...new Map(out.map(x=>[x.code,x])).values()];if(!uniq.length)throw new Error('THEME_FRONT_EMPTY');return uniq;
}
async function loadThemesLegacy(){
  const out:any[]=[];
  for(let page=1;page<=8;page++){
    const html=await fetchHtml(`https://finance.naver.com/sise/theme.naver?page=${page}`,10000),$=cheerio.load(html);let count=0;
    $('a[href*="sise_group_detail.naver?type=theme"]').each((_,el)=>{
      const a=$(el),href=a.attr('href')||'',m=href.match(/[?&]no=(\d+)/),name=a.text().replace(/\s+/g,' ').trim();if(!m||!name)return;
      const tr=a.closest('tr'),cells=tr.find('td').map((_,td)=>$(td).text().replace(/\s+/g,' ').trim()).get();
      let change=0;for(const c of cells){if(/[-+]?\d+(?:\.\d+)?%/.test(c)){change=n(c);break}}
      out.push({code:m[1],name,changePct:change,up:0,down:0,flat:0,count:0,source:'Naver legacy'});count++;
    });
    if(!count)break;
  }
  const uniq=[...new Map(out.map(x=>[x.code,x])).values()];if(!uniq.length)throw new Error('THEME_LEGACY_EMPTY');return uniq;
}
async function loadThemes(force=false){
  if(!force&&themeCache.data.length&&Date.now()-themeCache.time<CACHE_TTL)return themeCache.data;
  let data:any[]=[];try{data=await loadThemesFront()}catch{data=await loadThemesLegacy()}
  data.sort((a,b)=>b.changePct-a.changePct);themeCache.time=Date.now();themeCache.data=data;return data;
}

function normalizeMember(x:any){const raw=String(x?.itemCode??x?.stockCode??x?.code??'').replace(/\D/g,''),code=raw.match(/\d{6}/)?.[0]||'',name=String(x?.stockName??x?.itemName??x?.name??'').trim();if(!code||!name)return null;return {code,name,market:normalizeMarket(x?.marketType??x?.stockExchangeType??x?.market??x?.category),price:n(x?.closePrice??x?.currentPrice??x?.nowVal??x?.price)||null,changePct:n(x?.fluctuationsRatio??x?.changeRate??x?.changePct??x?.rate),marketValue:n(x?.marketValue??x?.marketCap)||null}}
async function loadThemeMembersFront(code:string){
  const out:any[]=[];
  for(let page=1;page<=6;page++){
    const url=`https://m.stock.naver.com/front-api/domestic/sector/item/list?sectorCode=${encodeURIComponent(code)}&sectorType=theme&sectorSortType=CHANGE_RATE&page=${page}&pageSize=100`;
    const j=await fetchJson(url,10000),rows=pickArray(j,['stocks','items','result','data']);if(!rows.length)break;
    for(const x of rows){const s=normalizeMember(x);if(s)out.push(s)}if(rows.length<100||j?.result?.hasNext===false)break;
  }
  const uniq=[...new Map(out.map(x=>[x.code,x])).values()];if(!uniq.length)throw new Error('MEMBER_FRONT_EMPTY');return uniq;
}
async function loadThemeMembersLegacy(code:string){
  const html=await fetchHtml(`https://finance.naver.com/sise/sise_group_detail.naver?type=theme&no=${encodeURIComponent(code)}`,10000),$=cheerio.load(html),out:any[]=[];
  $('a[href*="/item/main.naver?code="]').each((_,el)=>{
    const a=$(el),href=a.attr('href')||'',m=href.match(/code=(\d{6})/),name=a.text().replace(/\s+/g,' ').trim();if(!m||!name)return;
    const tr=a.closest('tr'),cells=tr.find('td').map((_,td)=>$(td).text().replace(/\s+/g,' ').trim()).get();
    let price=0,change=0;for(const c of cells){if(!price&&/^\d[\d,]*$/.test(c))price=n(c);if(/[-+]?\d+(?:\.\d+)?%/.test(c)){change=n(c);break}}
    out.push({code:m[1],name,market:'UNKNOWN',price:price||null,changePct:change,marketValue:null});
  });
  const uniq=[...new Map(out.map(x=>[x.code,x])).values()];if(!uniq.length)throw new Error('MEMBER_LEGACY_EMPTY');return uniq;
}
async function loadThemeMembers(code:string,force=false){
  const c=memberCache.get(code);if(!force&&c&&Date.now()-c.time<CACHE_TTL)return c.data;
  let data:any[]=[];try{data=await loadThemeMembersFront(code)}catch{data=await loadThemeMembersLegacy(code)}memberCache.set(code,{time:Date.now(),data});return data;
}

type Bar={date:string;open:number;high:number;low:number;close:number;volume:number;ma5?:number|null;ma20?:number|null;ma60?:number|null};
function sma(a:number[],w:number,i:number){if(i<w-1)return null;let s=0;for(let k=i-w+1;k<=i;k++)s+=a[k];return s/w}
async function loadHistory(code:string,asOf:string,lookbackDays:number){
  const count=clamp(Math.ceil(lookbackDays*2.2)+100,220,1000),end=ymd(asOf)||'99999999';
  const r=await fetchRaw(`https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(code)}&timeframe=day&count=${count}&requestType=0`,12000,'text/xml,text/plain,*/*'),xml=await r.text(),out:Bar[]=[];
  for(const m of xml.matchAll(/<item\s+data=["']([^"']+)["']/g)){
    const [date,o,h,l,c,v]=m[1].split('|'),close=Number(c);if(!/^\d{8}$/.test(date)||date>end||!Number.isFinite(close)||close<=0)continue;out.push({date,open:Number(o)||close,high:Number(h)||close,low:Number(l)||close,close,volume:Number(v)||0})
  }
  out.sort((a,b)=>a.date.localeCompare(b.date));if(out.length<80)throw new Error('HISTORY_SHORT');return out;
}

type Cfg={asOf:string;lookbackDays:number;maCompressPct:number;near60Pct:number;rangeDays:number;rangePct:number;minSlope20Pct:number;spikeLookback:number;minSpikePct:number;near20Pct:number;dryVolumeRatio:number;volumeSurgeLookback:number;minVolumeSurge:number;higherLowDays:number;minHigherLowPct:number;useCompress:boolean;useNear60:boolean;useRange:boolean;useSlope20:boolean;usePriorSpike:boolean;useNear20:boolean;useDryVolume:boolean;useVolumeSurge:boolean;useHigherLow:boolean;mode:string};
function analyse(rows:Bar[],cfg:Cfg){
  const closes=rows.map(x=>x.close);for(let i=0;i<rows.length;i++){rows[i].ma5=sma(closes,5,i);rows[i].ma20=sma(closes,20,i);rows[i].ma60=sma(closes,60,i)}
  const i=rows.length-1,cur=rows[i];if(!cur.ma5||!cur.ma20||!cur.ma60)return null;
  const mas=[cur.ma5,cur.ma20,cur.ma60] as number[],compress=(Math.max(...mas)-Math.min(...mas))/cur.close*100,d60=(cur.close-cur.ma60)/cur.ma60*100,d20=(cur.close-cur.ma20)/cur.ma20*100;
  const b20=i>=5?rows[i-5].ma20:null,slope20=b20?((cur.ma20-b20)/b20*100):0;
  const rs=rows.slice(Math.max(0,i-cfg.rangeDays+1),i+1),recentRange=(Math.max(...rs.map(x=>x.high))-Math.min(...rs.map(x=>x.low)))/cur.close*100;
  const av20=rows.slice(Math.max(0,i-19),i+1).reduce((s,x)=>s+x.volume,0)/Math.min(20,i+1),dryRatio=av20?cur.volume/av20:1;
  let spikePct=-999,spikeDate='';const spikeStart=Math.max(1,i-cfg.spikeLookback);
  for(let k=spikeStart;k<=i;k++){const pct=(rows[k].close/rows[k-1].close-1)*100;if(pct>spikePct){spikePct=pct;spikeDate=rows[k].date}}
  let surge=0,surgeDate='';const vs=Math.max(20,i-cfg.volumeSurgeLookback);
  for(let k=vs;k<=i;k++){const base=rows.slice(Math.max(0,k-20),k).reduce((s,x)=>s+x.volume,0)/Math.max(1,Math.min(20,k));const r=base?rows[k].volume/base:0;if(r>surge){surge=r;surgeDate=rows[k].date}}
  const hd=Math.max(3,cfg.higherLowDays),recentLow=Math.min(...rows.slice(Math.max(0,i-hd+1),i+1).map(x=>x.low)),prevLow=Math.min(...rows.slice(Math.max(0,i-hd*2+1),Math.max(1,i-hd+1)).map(x=>x.low)),higherLowPct=prevLow?((recentLow-prevLow)/prevLow*100):0;
  const checks={compress:compress<=cfg.maCompressPct,near60:Math.abs(d60)<=cfg.near60Pct,range:recentRange<=cfg.rangePct,slope20:slope20>=cfg.minSlope20Pct,priorSpike:spikePct>=cfg.minSpikePct,near20:Math.abs(d20)<=cfg.near20Pct,dryVolume:dryRatio<=cfg.dryVolumeRatio,volumeSurge:surge>=cfg.minVolumeSurge,higherLow:higherLowPct>=cfg.minHigherLowPct};
  const coreA=checks.compress&&checks.near60&&checks.range&&checks.slope20;
  const coreB=checks.priorSpike&&checks.near20&&checks.dryVolume;
  const modePass=cfg.mode==='A'?coreA:cfg.mode==='B'?coreB:cfg.mode==='ANY'?true:(coreA||coreB);
  const enabled:[boolean,boolean][]=[[cfg.useCompress,checks.compress],[cfg.useNear60,checks.near60],[cfg.useRange,checks.range],[cfg.useSlope20,checks.slope20],[cfg.usePriorSpike,checks.priorSpike],[cfg.useNear20,checks.near20],[cfg.useDryVolume,checks.dryVolume],[cfg.useVolumeSurge,checks.volumeSurge],[cfg.useHigherLow,checks.higherLow]];
  const strictPass=enabled.every(([use,ok])=>!use||ok),passed=modePass&&strictPass;
  let score=0;
  score+=18*(1-clamp(compress/Math.max(cfg.maCompressPct*1.5,.01),0,1));
  score+=14*(1-clamp(Math.abs(d60)/Math.max(cfg.near60Pct*1.5,.01),0,1));
  score+=10*(1-clamp(recentRange/Math.max(cfg.rangePct*1.5,.01),0,1));
  score+=8*clamp((slope20-cfg.minSlope20Pct+1.5)/4,0,1);
  score+=12*clamp(spikePct/Math.max(cfg.minSpikePct*2,1),0,1);
  score+=8*clamp(surge/Math.max(cfg.minVolumeSurge*2,1),0,1);
  score+=7*clamp((cfg.dryVolumeRatio-dryRatio+0.5)/1.0,0,1);
  score+=8*clamp((higherLowPct-cfg.minHigherLowPct+3)/8,0,1);
  score=clamp(score,0,75);
  const reasons:string[]=[];if(checks.compress)reasons.push('이평압축');if(checks.near60)reasons.push('60일선근처');if(checks.range)reasons.push('가격압축');if(checks.priorSpike)reasons.push('과거급등');if(checks.volumeSurge)reasons.push('선행거래량');if(checks.dryVolume)reasons.push('거래량감소');if(checks.higherLow)reasons.push('저점상승');
  return {passed,modePass,patternA:coreA,patternB:coreB,techScore:Math.round(score),asOf:dtext(cur.date),close:cur.close,ma5:round(cur.ma5,2),ma20:round(cur.ma20,2),ma60:round(cur.ma60,2),maCompressPct:round(compress,2),dist60Pct:round(d60,2),dist20Pct:round(d20,2),rangePct:round(recentRange,2),slope20Pct:round(slope20,2),dryVolumeRatio:round(dryRatio,2),priorSpikePct:round(spikePct,2),priorSpikeDate:dtext(spikeDate),volumeSurgeRatio:round(surge,2),volumeSurgeDate:dtext(surgeDate),higherLowPct:round(higherLowPct,2),reasons,checks,chart:rows.slice(Math.max(0,i-100),i+1).map(x=>({date:dtext(x.date),close:x.close,ma5:x.ma5?round(x.ma5,2):null,ma20:x.ma20?round(x.ma20,2):null,ma60:x.ma60?round(x.ma60,2):null,volume:x.volume}))}
}
async function scanOne(s:any,cfg:Cfg){try{const rows=await loadHistory(String(s.code),cfg.asOf,cfg.lookbackDays),a=analyse(rows,cfg);return a?{...s,...a}:null}catch(e:any){return {scanError:true,code:s.code,name:s.name,message:String(e?.message||e)}}}

export async function GET(req:Request){
  const u=new URL(req.url),op=u.searchParams.get('op')||'';
  if(op==='health'){
    try{const themes=await loadThemes(true);let memberCount=0;if(themes[0]){try{memberCount=(await loadThemeMembers(themes[0].code,true)).length}catch{}}return NextResponse.json({ok:themes.length>0,themes:themes.length,firstTheme:themes[0]?.name||null,firstThemeMembers:memberCount,source:themes[0]?.source||null,time:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}})}catch(e:any){return NextResponse.json({ok:false,error:String(e?.message||e),time:new Date().toISOString()},{status:502,headers:{'Cache-Control':'no-store'}})}
  }
  if(op==='auth')return NextResponse.json({ok:validToken(requestToken(req))},{headers:{'Cache-Control':'no-store'}});
  if(!validToken(requestToken(req)))return unauthorized();
  if(op==='themes'){
    try{const themes=await loadThemes(u.searchParams.get('force')==='1');return NextResponse.json({themes,count:themes.length},{headers:{'Cache-Control':'no-store'}})}catch(e:any){return NextResponse.json({error:'THEME_LIST_FAILED',message:String(e?.message||e)},{status:502})}
  }
  if(op==='themeMembers'){
    const code=String(u.searchParams.get('code')||'').replace(/\D/g,'');if(!code)return NextResponse.json({error:'BAD_THEME_CODE'},{status:400});
    try{const members=await loadThemeMembers(code,u.searchParams.get('force')==='1');return NextResponse.json({members,count:members.length,themeCode:code},{headers:{'Cache-Control':'no-store'}})}catch(e:any){return NextResponse.json({error:'THEME_MEMBERS_FAILED',message:String(e?.message||e)},{status:502})}
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
  if(op==='scan'){
    const stocks=Array.isArray(body.stocks)?body.stocks.slice(0,24):[];if(!stocks.length)return NextResponse.json({error:'NO_STOCKS'},{status:400});
    const b=body.cfg||body;
    const cfg:Cfg={asOf:String(b.asOf||''),lookbackDays:clamp(Number(b.lookbackDays??180),90,420),maCompressPct:clamp(Number(b.maCompressPct??12),1,40),near60Pct:clamp(Number(b.near60Pct??10),1,40),rangeDays:clamp(Number(b.rangeDays??10),5,30),rangePct:clamp(Number(b.rangePct??18),3,60),minSlope20Pct:clamp(Number(b.minSlope20Pct??-1.5),-10,10),spikeLookback:clamp(Number(b.spikeLookback??90),20,240),minSpikePct:clamp(Number(b.minSpikePct??8),2,30),near20Pct:clamp(Number(b.near20Pct??7),1,30),dryVolumeRatio:clamp(Number(b.dryVolumeRatio??1.2),0.1,5),volumeSurgeLookback:clamp(Number(b.volumeSurgeLookback??90),20,240),minVolumeSurge:clamp(Number(b.minVolumeSurge??2),1,10),higherLowDays:clamp(Number(b.higherLowDays??10),3,30),minHigherLowPct:clamp(Number(b.minHigherLowPct??-3),-20,20),useCompress:!!b.useCompress,useNear60:!!b.useNear60,useRange:!!b.useRange,useSlope20:!!b.useSlope20,usePriorSpike:!!b.usePriorSpike,useNear20:!!b.useNear20,useDryVolume:!!b.useDryVolume,useVolumeSurge:!!b.useVolumeSurge,useHigherLow:!!b.useHigherLow,mode:String(b.mode||'A_OR_B')};
    if(!/^\d{4}-\d{2}-\d{2}$/.test(cfg.asOf)||stocks.some((s:any)=>!/^\d{6}$/.test(String(s.code))))return NextResponse.json({error:'BAD_SETTINGS',message:'기준일 또는 종목코드를 확인해 주세요.'},{status:400});
    const results:any[]=[],errors:any[]=[];for(let i=0;i<stocks.length;i+=6){const rr=await Promise.all(stocks.slice(i,i+6).map((s:any)=>scanOne(s,cfg)));for(const r of rr){if(r?.scanError)errors.push(r);else if(r)results.push(r)}}
    return NextResponse.json({results,processed:stocks.length,failed:errors.length,errors},{headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
  }
  return NextResponse.json({error:'BAD_OP'},{status:400});
}
