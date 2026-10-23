// @ts-nocheck
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import krxSamsungSample from '../../../public/krx-investor-data/005930.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Daily-step version. Share the permanent-auth scope/code with the existing Korean flow radar.
const SCOPE = 'gc-flow-accumulation-radar-20261002-v1';
const ACCESS_CODE_HASH = '696db21cbff09ada1a61dce8499bd5de35f5f8a7f68a90ac294e091a131ca70f';
const CACHE_TTL = 10 * 60 * 1000;
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
async function fetchUniverse(market){
  if(!['ALL','KOSPI','KOSDAQ'].includes(market))throw new Error('INVALID_MARKET');
  // Use only tickers for which the KRX collector wrote a validated data file.
  // Never substitute Naver or an unverified whole-market list.
  let stocks=[];
  if(process.env.VERCEL_URL){
    try {
      const response=await fetch('https://'+process.env.VERCEL_URL+'/krx-investor-data/manifest.json',
        {signal:AbortSignal.timeout(4000),cache:'no-store'});
      if(response.ok){
        const manifest=await response.json();
        if(manifest.source==='KRX via pykrx' && Array.isArray(manifest.stocks))
          stocks=manifest.stocks.filter(x=>/^\d{6}$/.test(String(x.code))&&['KOSPI','KOSDAQ'].includes(x.market))
            .map(x=>({code:x.code,name:x.name,market:x.market,source:'KRX verified daily quantity'}));
      }
    } catch {}
  }
  // Existing verified sample remains usable while a full manifest is being prepared.
  if(!stocks.some(x=>x.code==='005930'))
    stocks.push({code:'005930',name:'삼성전자',market:'KOSPI',source:'KRX verified sample'});
  const selected=stocks.filter(x=>market==='ALL'||x.market===market);
  if(!selected.length)throw new Error('KRX_UNIVERSE_NOT_COLLECTED_'+market);
  return selected;
}

async function loadVerifiedKrxSample(code,target,needDays){
  // Only use separately collected, validated KRX samples. Never invent missing rows.
  // Batch collector writes one public JSON file per ticker; missing tickers remain unverified.
  let payload=null;
  if(code==='005930')payload=krxSamsungSample;
  else if(process.env.VERCEL_URL){
    try{
      const response=await fetch('https://'+process.env.VERCEL_URL+'/krx-investor-data/'+code+'.json',
        {signal:AbortSignal.timeout(3500),cache:'no-store'});
      if(response.ok)payload=await response.json();
    }catch{}
  }
  if(!payload)return null;
  if(payload?.source!=='KRX via pykrx'||payload?.ticker!==code||!Array.isArray(payload.rows))return null;
  const rows=payload.rows.filter(x=>/^\d{8}$/.test(String(x.date))&&String(x.date)<=target)
    .map(x=>{
      const q=x.netBuyQuantity||{};
      const groups=['금융투자','보험','투신','사모','은행','기타금융','연기금'];
      // Never coerce absent investor figures to zero; reject incomplete institutional totals.
      if(!Number.isSafeInteger(q['외국인'])||!Number.isSafeInteger(q['개인'])||groups.some(g=>!Number.isSafeInteger(q[g])))return null;
      return {date:String(x.date),foreign:q['외국인'],institution:groups.reduce((sum,g)=>sum+q[g],0),individual:q['개인'],source:'KRX verified daily quantity'};
    }).filter(Boolean).sort((a,b)=>b.date.localeCompare(a.date));
  if(new Set(rows.map(x=>x.date)).size!==rows.length||rows.length<Math.min(needDays,60))return null;
  if(rows.length<needDays && !(payload.newListingVerified===true && payload.partialHistory===true && payload.listingFirstTradingDate===payload.oldest))return null;
  return rows;
}
async function loadTrendLong(code,asOf,needDays){
  const target=ymd(asOf),cacheKey=code+'|'+target+'|'+needDays;
  const cached=trendCache.get(cacheKey);
  if(cached&&Date.now()-cached.time<CACHE_TTL)return cached.data;
  const verifiedKrx=await loadVerifiedKrxSample(code,target,needDays);
  if(!verifiedKrx)throw new Error('KRX_DATA_UNAVAILABLE_OR_SHORT_NEED_'+needDays);
  trendCache.set(cacheKey,{time:Date.now(),data:verifiedKrx});
  if(trendCache.size>600)trendCache.delete(trendCache.keys().next().value);
  return verifiedKrx;
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
          const trends=await loadTrendLong(code,asOf,needDays),actualDays=Math.min(maxDays,trends.length),windows=buildWindows(trends,minDays,actualDays),w60=windows['60'];
          if(!w60)throw new Error('WINDOW_60_MISSING');
          return {...s,code,asOf:dashDate(trends[0]?.date),minDays,maxDays:actualDays,requestedDays:maxDays,actualDays,partialHistory:actualDays<maxDays,windows,
            foreign60:w60.foreignSum,institution60:w60.institutionSum,combined60:w60.combinedSum,individual60:w60.individualSum,
            individual250Known:trends.slice(0,maxDays).filter(x=>x.individual!==null&&x.individual!==undefined).length,
            source:w60.source||trends[0]?.source||'',
            naver:null,
            investor:null};
        }catch(e){return {...s,code,scanError:String(e?.message||e)};}
      }));
      for(const r of rr){if(r.scanError)errors.push(r);else results.push(r);}
    }
    return NextResponse.json({results,errors,count:results.length,asOf,minDays,maxDays},{headers:{'Cache-Control':'no-store'}});
  }
  return NextResponse.json({error:'BAD_OP'},{status:400});
}
