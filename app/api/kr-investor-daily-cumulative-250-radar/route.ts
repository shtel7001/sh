// @ts-nocheck
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Daily-step version. Share the permanent-auth scope/code with the existing Korean flow radar.
const SCOPE = 'gc-flow-accumulation-radar-20261002-v1';
const ACCESS_CODE_HASH = '696db21cbff09ada1a61dce8499bd5de35f5f8a7f68a90ac294e091a131ca70f';
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';
const CACHE_TTL = 10 * 60 * 1000;
const universeCache = new Map();
const trendCache = new Map();

function secret(){ return process.env.SESSION_SECRET || ''; }
function sign(payload){ return crypto.createHmac('sha256', secret()+':'+SCOPE).update(payload).digest('base64url'); }
function createToken(){ const p=SCOPE+'.'+crypto.randomBytes(24).toString('base64url'); return p+'.'+sign(p); }
function requestToken(req){ return req.headers.get('x-auth-token') || (req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''); }
function validToken(token){
  if(!token||!secret()) return false;
  const i=token.lastIndexOf('.'); if(i<0) return false;
  const p=token.slice(0,i),s=token.slice(i+1); if(!p.startsWith(SCOPE+'.')) return false;
  const e=sign(p); if(s.length!==e.length) return false;
  try{return crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e));}catch{return false;}
}
function validPassword(v){
  const actual=crypto.createHash('sha256').update(String(v||'').trim()).digest();
  try{return actual.length===32&&crypto.timingSafeEqual(actual,Buffer.from(ACCESS_CODE_HASH,'hex'));}catch{return false;}
}
function unauthorized(){return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers:{'Cache-Control':'no-store'}});}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function n(v){
  if(typeof v==='number') return Number.isFinite(v)?v:0;
  const s=String(v??'').replace(/,/g,'').replace(/[원주%배\s+]/g,'').trim();
  if(!s||s==='-'||s==='--') return 0;
  const x=Number(s.replace(/^\((.*)\)$/,'-$1')); return Number.isFinite(x)?x:0;
}
function ymd(v){return String(v??'').replace(/\D/g,'').slice(0,8);}
function dashDate(v){const s=ymd(v);return /^\d{8}$/.test(s)?s.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):String(v??'');}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

async function fetchRaw(url,timeoutMs=12000,accept='application/json,text/plain,*/*'){
  let last='';
  for(let attempt=0;attempt<3;attempt++){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);
    try{
      const r=await fetch(url,{signal:c.signal,cache:'no-store',redirect:'follow',headers:{
        'User-Agent':UA,'Accept':accept,'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.6',
        'Referer':url.includes('finance.naver.com')?'https://finance.naver.com/':url.includes('stock.naver.com')?'https://stock.naver.com/':'https://m.stock.naver.com/'
      }});
      if(!r.ok){last='HTTP_'+r.status;if(r.status===429||r.status>=500)await sleep(160*(attempt+1));else break;continue;}
      return r;
    }catch(e){last=String(e?.message||e);await sleep(160*(attempt+1));}
    finally{clearTimeout(t);}
  }
  throw new Error(last||'FETCH_FAILED');
}
async function fetchJson(url,timeoutMs=12000){const r=await fetchRaw(url,timeoutMs);const tx=await r.text();try{return JSON.parse(tx);}catch{throw new Error('JSON_PARSE_FAILED');}}
async function fetchHtml(url,timeoutMs=12000){
  const r=await fetchRaw(url,timeoutMs,'text/html,application/xhtml+xml,*/*');
  const b=Buffer.from(await r.arrayBuffer()),ct=(r.headers.get('content-type')||'').toLowerCase();
  return ct.includes('utf-8')?b.toString('utf8'):iconv.decode(b,'EUC-KR');
}
function normalizeMarket(v){const s=String(v||'').toUpperCase();if(s.includes('KOSDAQ')||s==='KQ'||s==='2')return 'KOSDAQ';if(s.includes('KOSPI')||s==='KS'||s==='1')return 'KOSPI';return 'UNKNOWN';}
function firstArray(j){
  if(Array.isArray(j))return j;
  for(const k of ['items','stocks','content','data','result']){
    if(Array.isArray(j?.[k]))return j[k];
    if(Array.isArray(j?.result?.[k]))return j.result[k];
  }
  return [];
}
function normalizeUniverse(x,market){
  const code=String(x?.itemCode??x?.itemcode??x?.stockCode??x?.code??'').match(/\d{6}/)?.[0]||'';
  const name=String(x?.stockName??x?.name??x?.itemName??x?.itemname??'').trim();
  if(!code||!name)return null;
  const mk=normalizeMarket(x?.marketType??x?.market??x?.stockExchangeType?.name??market);
  return {code,name,market:mk!=='UNKNOWN'?mk:market,currentPrice:n(x?.closePrice??x?.currentPrice??x?.nowVal??x?.price)||null,marketValue:n(x?.marketValue??x?.marketCap??x?.marketSum)||null};
}
async function fetchUniverseNew(market){
  const out=[],seen=new Set();
  for(let page=0;page<30;page++){
    const url='https://stock.naver.com/api/domestic/market/stock/default?tradeType=KRX&marketType='+market+'&orderType=marketSum&startIdx='+page+'&pageSize=100';
    const rows=firstArray(await fetchJson(url));if(!rows.length)break;let added=0;
    for(const x of rows){const r=normalizeUniverse(x,market);if(r&&!seen.has(r.code)){seen.add(r.code);out.push(r);added++;}}
    if(!added||rows.length<100)break;
  }
  if(out.length<300)throw new Error('NEW_'+market+'_UNIVERSE_SHORT_'+out.length);
  return out;
}
async function fetchUniverseOld(market){
  const out=[],seen=new Set();
  for(let page=1;page<=30;page++){
    const rows=firstArray(await fetchJson('https://m.stock.naver.com/api/stocks/marketValue/'+market+'?page='+page+'&pageSize=100'));
    if(!rows.length)break;let added=0;
    for(const x of rows){const r=normalizeUniverse(x,market);if(r&&!seen.has(r.code)){seen.add(r.code);out.push(r);added++;}}
    if(!added||rows.length<100)break;
  }
  if(out.length<300)throw new Error('OLD_'+market+'_UNIVERSE_SHORT_'+out.length);
  return out;
}
async function fetchUniverseMarket(market){
  const c=universeCache.get(market);if(c&&Date.now()-c.time<CACHE_TTL)return c.data;
  let data=[];try{data=await fetchUniverseNew(market);}catch{data=await fetchUniverseOld(market);}
  universeCache.set(market,{time:Date.now(),data});return data;
}
async function fetchUniverse(market){
  if(market==='KOSPI')return fetchUniverseMarket('KOSPI');
  if(market==='KOSDAQ')return fetchUniverseMarket('KOSDAQ');
  const [a,b]=await Promise.all([fetchUniverseMarket('KOSPI'),fetchUniverseMarket('KOSDAQ')]);return a.concat(b);
}

function keyValue(o,hints){
  if(!o||typeof o!=='object')return undefined;
  for(const [k,v] of Object.entries(o)){const s=k.toLowerCase().replace(/[_\-]/g,'');if(hints.some(h=>s.includes(h)))return v;}
  return undefined;
}
function trendRow(x,source){
  const date=ymd(x?.bizdate??x?.localDate??x?.date??x?.tradeDate??x?.businessDay??keyValue(x,['bizdate','tradedate','localdate','date']));
  if(!/^\d{8}$/.test(date))return null;
  const foreign=x?.foreignerPureBuyQuant??x?.foreignPureBuyQuant??x?.foreignerNetBuyQuantity??x?.foreignNetBuy??x?.foreignPureBuy??x?.foreignValue??keyValue(x,['foreignerpurebuy','foreignpurebuy','foreignnetbuy','foreignvalue','frgnpurebuy','frgnnetbuy']);
  const institution=x?.organPureBuyQuant??x?.institutionPureBuyQuant??x?.institutionNetBuyQuantity??x?.organNetBuy??x?.institutionalValue??keyValue(x,['organpurebuy','institutionpurebuy','institutionnetbuy','organnnetbuy','institutionalvalue','orgpurebuy','orgnetbuy']);
  const individual=x?.individualPureBuyQuant??x?.personalPureBuyQuant??x?.individualNetBuyQuantity??x?.personalValue??x?.individualNetBuy??keyValue(x,['individualpurebuy','personalpurebuy','individualnetbuy','personalvalue','individualnetbuy','personnetbuy']);
  const hold=x?.foreignerHoldRatio??x?.foreignHoldRatio??x?.foreignRate??keyValue(x,['foreignerholdratio','foreignholdratio','foreignrate']);
  if(foreign===undefined&&institution===undefined&&individual===undefined)return null;
  return {date,foreign:n(foreign),institution:n(institution),individual:individual===undefined?null:n(individual),holdRatio:n(hold),source};
}
function collectArrays(v,depth=0,out=[]){
  if(depth>5||v==null)return out;
  if(Array.isArray(v)){if(v.length&&typeof v[0]==='object')out.push(v);for(const x of v.slice(0,5))collectArrays(x,depth+1,out);return out;}
  if(typeof v==='object')for(const x of Object.values(v))collectArrays(x,depth+1,out);
  return out;
}
function extractTrendRows(j,source){
  const arrays=collectArrays(j);let best=[];
  for(const a of arrays){const rows=a.map(x=>trendRow(x,source)).filter(Boolean);if(rows.length>best.length)best=rows;}
  if(Array.isArray(j)){const rows=j.map(x=>trendRow(x,source)).filter(Boolean);if(rows.length>best.length)best=rows;}
  return best;
}
async function trendPage(code,startIdx,pageSize){
  const url='https://stock.naver.com/api/domestic/detail/'+encodeURIComponent(code)+'/trend?tradeType=KRX&startIdx='+startIdx+'&pageSize='+pageSize;
  return extractTrendRows(await fetchJson(url,14000),'Naver stock.naver trend');
}
async function loadTrendMobile(code){
  const urls=[
    'https://m.stock.naver.com/api/stock/'+encodeURIComponent(code)+'/trend',
    'https://m.stock.naver.com/front-api/stock/domestic/trend?code='+encodeURIComponent(code)
  ];
  let all=[];
  for(const u of urls){try{all=all.concat(extractTrendRows(await fetchJson(u,11000),'Naver mobile trend'));}catch{}}
  return [...new Map(all.map(x=>[x.date,x])).values()].sort((a,b)=>b.date.localeCompare(a.date));
}
async function loadTrendLegacy(code,maxPages=40){
  const out=[];
  for(let page=1;page<=maxPages;page++){
    const html=await fetchHtml('https://finance.naver.com/item/frgn.naver?code='+encodeURIComponent(code)+'&page='+page,12000),$=cheerio.load(html);
    let rows=0;
    $('table.type2 tr').each((_,tr)=>{
      const cells=$(tr).find('td').map((_,td)=>$(td).text().replace(/\s+/g,' ').trim()).get();
      if(cells.length<7)return;
      const date=ymd(cells[0]);if(!/^\d{8}$/.test(date))return;rows++;
      out.push({date,foreign:n(cells[6]),institution:n(cells[5]),individual:null,holdRatio:n(cells[8]||0),source:'Naver PC investor'});
    });
    if(!rows)break;
  }
  return [...new Map(out.map(x=>[x.date,x])).values()].sort((a,b)=>b.date.localeCompare(a.date));
}
function usableRows(rows,target){return [...new Map(rows.map(x=>[x.date,x])).values()].filter(x=>!target||x.date<=target).sort((a,b)=>b.date.localeCompare(a.date));}
async function loadTrendLong(code,asOf,needDays){
  const target=ymd(asOf),cacheKey=code+'|'+target+'|'+needDays;
  const cached=trendCache.get(cacheKey);if(cached&&Date.now()-cached.time<CACHE_TTL)return cached.data;
  let all=[],attempts=[],pageSize=clamp(Math.max(120,needDays+20),120,320);
  const starts=[0,1,2,3,pageSize,pageSize*2,100,200,300,400,500];
  for(const start of starts){
    try{
      const rows=await trendPage(code,start,pageSize);
      const before=usableRows(all,target).length;all=all.concat(rows);const after=usableRows(all,target).length;
      attempts.push({start,pageSize,rows:rows.length,added:after-before});
      if(after>=needDays){const data=usableRows(all,target);trendCache.set(cacheKey,{time:Date.now(),data});return data;}
    }catch(e){attempts.push({start,error:String(e?.message||e)});}
  }
  try{all=all.concat(await loadTrendMobile(code));}catch{}
  if(usableRows(all,target).length<needDays){
    try{all=all.concat(await loadTrendLegacy(code,Math.ceil(needDays/18)+6));}catch{}
  }
  const data=usableRows(all,target);
  if(data.length<needDays)throw new Error('TREND_RANGE_SHORT_'+data.length+'_NEED_'+needDays);
  trendCache.set(cacheKey,{time:Date.now(),data});
  if(trendCache.size>600){const k=trendCache.keys().next().value;trendCache.delete(k);}
  return data;
}
function buildWindows(trends,minDays,maxDays){
  const windows={};
  const list=[];for(let d=minDays;d<=maxDays;d++)list.push(d);
  if(!list.includes(60))list.push(60);
  list.sort((a,b)=>a-b);
  for(const d of list){
    if(trends.length<d)continue;
    const a=trends.slice(0,d);
    const foreignSum=a.reduce((s,x)=>s+x.foreign,0);
    const institutionSum=a.reduce((s,x)=>s+x.institution,0);
    const knownIndividual=a.filter(x=>x.individual!==null&&x.individual!==undefined);
    const individualSum=knownIndividual.length===d?knownIndividual.reduce((s,x)=>s+Number(x.individual||0),0):null;
    windows[String(d)]={days:d,foreignSum,institutionSum,individualSum,combinedSum:foreignSum+institutionSum,individualKnownDays:knownIndividual.length,
      newest:dashDate(a[0]?.date),oldest:dashDate(a[a.length-1]?.date),source:a[0]?.source||''};
  }
  return windows;
}

export async function GET(req){
  const u=new URL(req.url),op=u.searchParams.get('op')||'';
  if(op==='probe' && validToken(requestToken(req))){
    const code=String(u.searchParams.get('code')||'005930').replace(/\D/g,'').slice(0,6),asOf=String(u.searchParams.get('asOf')||'2026-10-02'),days=clamp(Math.round(Number(u.searchParams.get('days')||250)),1,250);
    try{
      const rows=await loadTrendLong(code,asOf,days);
      return NextResponse.json({ok:true,code,asOf,requested:days,rows:rows.length,newest:dashDate(rows[0]?.date),oldest:dashDate(rows[days-1]?.date),individualKnown:rows.slice(0,days).filter(x=>x.individual!==null&&x.individual!==undefined).length,sample:rows.slice(0,3)},{headers:{'Cache-Control':'no-store'}});
    }catch(e){return NextResponse.json({ok:false,error:String(e?.message||e)},{status:502,headers:{'Cache-Control':'no-store'}});}
  }
  if(!validToken(requestToken(req)))return unauthorized();
  if(op==='universe'){
    try{const market=String(u.searchParams.get('market')||'ALL').toUpperCase();const rows=await fetchUniverse(market);return NextResponse.json({rows,count:rows.length,market},{headers:{'Cache-Control':'no-store'}});}
    catch(e){return NextResponse.json({error:'UNIVERSE_FAILED',message:String(e?.message||e)},{status:502});}
  }
  return NextResponse.json({error:'BAD_OP'},{status:400});
}

export async function POST(req){
  const u=new URL(req.url),op=u.searchParams.get('op')||'',body=await req.json().catch(()=>({}));
  if(op==='login'){
    if(!process.env.SESSION_SECRET)return NextResponse.json({error:'AUTH_NOT_CONFIGURED'},{status:503});
    if(!validPassword(String(body?.code||body?.password||'')))return NextResponse.json({error:'INVALID_CODE'},{status:401});
    return NextResponse.json({ok:true,token:createToken()},{headers:{'Cache-Control':'no-store'}});
  }
  if(!validToken(requestToken(req)))return unauthorized();
  if(op==='longFlow'){
    const stocks=Array.isArray(body.stocks)?body.stocks.slice(0,10):[];
    if(!stocks.length)return NextResponse.json({error:'NO_STOCKS'},{status:400});
    const b=body.cfg||{},asOf=String(b.asOf||''),minDays=clamp(Math.round(Number(b.minDays||1)),1,250),maxDays=clamp(Math.round(Number(b.maxDays||250)),1,250);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf)||minDays>maxDays)return NextResponse.json({error:'BAD_CONFIG'},{status:400});
    const needDays=Math.max(maxDays,60),results=[],errors=[];
    for(let i=0;i<stocks.length;i+=5){
      const rr=await Promise.all(stocks.slice(i,i+5).map(async s=>{
        const code=String(s?.code||'').replace(/\D/g,'').slice(0,6);
        try{
          const trends=await loadTrendLong(code,asOf,needDays),windows=buildWindows(trends,minDays,maxDays),w60=windows['60'];
          if(!w60)throw new Error('WINDOW_60_MISSING');
          return {...s,code,asOf:dashDate(trends[0]?.date),minDays,maxDays,windows,
            foreign60:w60.foreignSum,institution60:w60.institutionSum,combined60:w60.combinedSum,individual60:w60.individualSum,
            individual250Known:trends.slice(0,maxDays).filter(x=>x.individual!==null&&x.individual!==undefined).length,
            source:w60.source||trends[0]?.source||'',
            naver:'https://stock.naver.com/domestic/stock/'+code+'/price',
            investor:'https://stock.naver.com/domestic/stock/'+code+'/investmentinfo'};
        }catch(e){return {...s,code,scanError:String(e?.message||e)};}
      }));
      for(const r of rr){if(r.scanError)errors.push(r);else results.push(r);}
    }
    return NextResponse.json({results,errors,count:results.length,asOf,minDays,maxDays},{headers:{'Cache-Control':'no-store'}});
  }
  return NextResponse.json({error:'BAD_OP'},{status:400});
}
