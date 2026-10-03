// @ts-nocheck
import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Reuse the existing permanent-login scope/hash so the user's old one-time code and token keep working.
const SCOPE = 'gc-flow-accumulation-radar-20261002-v1';
const ACCESS_CODE_HASH = '696db21cbff09ada1a61dce8499bd5de35f5f8a7f68a90ac294e091a131ca70f';
const BASE = 'https://apis.data.go.kr/1220000/prlstMmUtPrviExpAcrs';
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';

const ITEM_NAMES:any = {
  item01:'반도체', item02:'철강제품', item03:'승용차', item04:'석유제품',
  item05:'무선통신기기', item06:'선박', item07:'자동차부품',
  item08:'컴퓨터 주변기기', item09:'정밀기기', item10:'가전제품'
};

function secret(){ return process.env.SESSION_SECRET || ''; }
function sign(payload:string){ return crypto.createHmac('sha256', `${secret()}:${SCOPE}`).update(payload).digest('base64url'); }
function createToken(){ const p=`${SCOPE}.${crypto.randomBytes(24).toString('base64url')}`; return `${p}.${sign(p)}`; }
function requestToken(req:Request){ return req.headers.get('x-auth-token') || (req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''); }
function validToken(token?:string|null){
  if(!token||!secret()) return false;
  const i=token.lastIndexOf('.'); if(i<0) return false;
  const p=token.slice(0,i),s=token.slice(i+1);
  if(!p.startsWith(`${SCOPE}.`)) return false;
  const e=sign(p); if(s.length!==e.length) return false;
  try{return crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e));}catch{return false;}
}
function validPassword(v:string){
  const actual=crypto.createHash('sha256').update(String(v||'').trim()).digest();
  try{return actual.length===32&&crypto.timingSafeEqual(actual,Buffer.from(ACCESS_CODE_HASH,'hex'));}catch{return false;}
}
function unauthorized(){return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers:{'Cache-Control':'no-store'}});}
function cleanKey(v:any){
  let s=String(v||'').trim();
  if(!s) return '';
  if(/%[0-9A-Fa-f]{2}/.test(s)){ try{s=decodeURIComponent(s);}catch{} }
  return s;
}
function dec(s:any){
  return String(s??'')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
}
function n(v:any){
  const s=String(v??'').replace(/,/g,'').replace(/[^0-9+\-.]/g,'');
  const x=Number(s); return Number.isFinite(x)?x:null;
}
function xmlObjects(xml:string){
  let blocks=[...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(m=>m[1]);
  if(!blocks.length && /<item01>/i.test(xml)) blocks=[xml];
  const rows:any[]=[];
  for(const block of blocks){
    const o:any={};
    for(const m of block.matchAll(/<([A-Za-z0-9_:-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)){
      const k=m[1].replace(/^.*:/,''); o[k]=dec(m[2].replace(/<[^>]+>/g,''));
    }
    if(Object.keys(o).length) rows.push(o);
  }
  return rows;
}
function apiError(xml:string){
  const pairs:any={};
  for(const k of ['resultCode','resultMsg','returnReasonCode','returnAuthMsg','errMsg']){
    const m=xml.match(new RegExp('<'+k+'[^>]*>([\\s\\S]*?)<\\/'+k+'>','i'));
    if(m)pairs[k]=dec(m[1]);
  }
  const msg=Object.values(pairs).filter(Boolean).join(' / ');
  return msg && !/NORMAL_SERVICE|정상/i.test(msg) ? msg : '';
}
function ymdFromAny(v:any){
  const s=String(v??'').trim();
  let m=s.match(/(20\d{2})[^0-9]?(0?[1-9]|1[0-2])[^0-9]?(0?[1-9]|[12]\d|3[01])/);
  if(m)return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  const d=s.replace(/\D/g,'');
  if(/^20\d{6}$/.test(d))return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
  return '';
}
function inferDate(o:any){
  const keys=Object.keys(o);
  const preferred=keys.filter(k=>/(date|ymd|dt|day|base|stdr|stat|prlst|period)/i.test(k));
  for(const k of preferred.concat(keys)){
    const d=ymdFromAny(o[k]); if(d)return d;
  }
  const yearVal=keys.find(k=>/^year$/i.test(k)||/yr$/i.test(k));
  const monthVal=keys.find(k=>/^month$/i.test(k)||/mm$/i.test(k));
  const dayVal=keys.find(k=>/^day$/i.test(k)||/dd$/i.test(k));
  if(yearVal&&monthVal){
    const y=String(o[yearVal]).replace(/\D/g,''),m=String(o[monthVal]).replace(/\D/g,'').padStart(2,'0');
    const d=dayVal?String(o[dayVal]).replace(/\D/g,'').padStart(2,'0'):'01';
    if(/^20\d{2}$/.test(y)&&/^\d{2}$/.test(m))return `${y}-${m}-${d}`;
  }
  return '';
}
function inferRangeEnd(o:any,date:string){
  const keys=Object.keys(o);
  for(const k of keys){
    if(/(term|period|range|ten|unit|days|se|gb|type)/i.test(k)){
      const s=String(o[k]||'');
      const mm=s.match(/(?:~|-|–)\s*(10|20|28|29|30|31)/);
      if(mm)return Number(mm[1]);
      if(/^\s*(10|20|28|29|30|31)\s*$/.test(s))return Number(s.trim());
    }
  }
  if(date){
    const dd=Number(date.slice(8,10));
    if(dd===10||dd===20||dd>=28)return dd;
  }
  return 0;
}
function normalizeRows(raw:any[]){
  return raw.map((o:any,idx:number)=>{
    const date=inferDate(o), rangeEnd=inferRangeEnd(o,date);
    const values:any={};
    for(let i=1;i<=10;i++){
      const key='item'+String(i).padStart(2,'0');
      const real=Object.keys(o).find(k=>k.toLowerCase()===key.toLowerCase());
      values[key]=real?n(o[real]):null;
    }
    let total:any=null;
    const totalKey=Object.keys(o).find(k=>/(tot.*exp|exp.*tot|total.*(amt|val|dlr)|all.*exp|item00)/i.test(k));
    if(totalKey)total=n(o[totalKey]);
    return {idx,date,rangeEnd,values,total,raw:o};
  }).filter((r:any)=>Object.values(r.values).some(v=>v!==null));
}
function isoMonth(s:string){return String(s||'').slice(0,7).replace('-','');}
function firstDateOfMonth(s:string){return String(s||'').slice(0,7)+'-01';}
function lastDateOfMonth(s:string){
  const [y,m]=String(s||'').slice(0,7).split('-').map(Number);
  if(!y||!m)return s; return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
}
async function callUrl(url:string){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),13000);
  try{
    const r=await fetch(url,{signal:c.signal,cache:'no-store',headers:{'User-Agent':UA,'Accept':'application/xml,text/xml,text/plain,*/*'}});
    const text=await r.text();
    return {ok:r.ok,status:r.status,text};
  }finally{clearTimeout(t);}
}
async function fetchOfficial(key:string,startDate:string,endDate:string){
  const serviceKey=cleanKey(key);
  if(!serviceKey)throw new Error('DATA_GO_KR_KEY_REQUIRED');
  const sm=isoMonth(startDate), em=isoMonth(endDate);
  const endpoints=[
    BASE,
    BASE+'/getPrlstMmUtPrviExpAcrs',
    BASE+'/getPrlstMmUtPrviExpAcrsList',
    BASE+'/getPrlstMmUtPrviExpAcrsInfo'
  ];
  const paramSets=[
    {strtYymm:sm,endYymm:em,numOfRows:'1000',pageNo:'1'},
    {startYymm:sm,endYymm:em,numOfRows:'1000',pageNo:'1'},
    {strtYmd:startDate.replace(/-/g,''),endYmd:endDate.replace(/-/g,''),numOfRows:'1000',pageNo:'1'},
    {startDate:startDate.replace(/-/g,''),endDate:endDate.replace(/-/g,''),numOfRows:'1000',pageNo:'1'},
    {numOfRows:'1000',pageNo:'1'}
  ];
  const diagnostics:any[]=[];
  for(const ep of endpoints){
    for(const p of paramSets){
      const q=new URLSearchParams({serviceKey,...p});
      const url=ep+'?'+q.toString();
      try{
        const r=await callUrl(url);
        const err=apiError(r.text);
        const raw=xmlObjects(r.text), rows=normalizeRows(raw);
        diagnostics.push({ep:ep.replace(BASE,'' )||'/',params:Object.keys(p),status:r.status,rows:rows.length,error:err||''});
        if(r.ok && rows.length){
          return {rows,endpoint:ep,diagnostics:diagnostics.slice(-3)};
        }
      }catch(e:any){
        diagnostics.push({ep:ep.replace(BASE,'')||'/',params:Object.keys(p),status:0,rows:0,error:String(e?.message||e)});
      }
    }
  }
  const useful=diagnostics.filter(x=>x.error||x.status!==404).slice(-8);
  throw new Error('OFFICIAL_API_NO_ROWS::'+JSON.stringify(useful));
}
function releaseDateOf(row:any){
  if(!row.date)return '';
  const [y,m,d]=row.date.split('-').map(Number);
  if(d===10)return new Date(Date.UTC(y,m-1,11)).toISOString().slice(0,10);
  if(d===20)return new Date(Date.UTC(y,m-1,21)).toISOString().slice(0,10);
  if(d>=28){return new Date(Date.UTC(y,m,1)).toISOString().slice(0,10);}
  return row.date;
}
function periodKey(row:any){
  if(!row.date)return '';
  const ym=row.date.slice(0,7), e=row.rangeEnd||Number(row.date.slice(8,10));
  if(e===10)return ym+'-10';
  if(e===20)return ym+'-20';
  if(e>=28)return ym+'-M';
  return row.date;
}
function previousMonthYm(ym:string){
  const [y,m]=ym.split('-').map(Number);return new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,7);
}
function enrich(rows:any[],startDate:string,endDate:string){
  for(const r of rows){r.releaseDate=releaseDateOf(r);r.periodKey=periodKey(r);}
  rows.sort((a,b)=>String(a.periodKey).localeCompare(String(b.periodKey)));
  const byKey=new Map(rows.map(r=>[r.periodKey,r]));
  for(const r of rows){
    const ym=String(r.periodKey).slice(0,7), suffix=String(r.periodKey).slice(7);
    const py=(Number(ym.slice(0,4))-1)+ym.slice(4)+suffix;
    const pm=previousMonthYm(ym)+suffix;
    const yr=byKey.get(py), mr=byKey.get(pm);
    r.metrics={};
    for(let i=1;i<=10;i++){
      const k='item'+String(i).padStart(2,'0'),v=r.values[k];
      const yv=yr?.values?.[k],mv=mr?.values?.[k];
      r.metrics[k]={
        value:v,
        yoy:(v!==null&&yv!==null&&Number(yv)!==0)?Math.round(((Number(v)/Number(yv))-1)*1000)/10:null,
        mom:(v!==null&&mv!==null&&Number(mv)!==0)?Math.round(((Number(v)/Number(mv))-1)*1000)/10:null
      };
    }
  }
  const filtered=rows.filter(r=>{
    const rd=r.releaseDate||r.date;
    return rd && rd>=startDate && rd<=endDate;
  });
  return filtered.length?filtered:rows;
}

export async function GET(req:Request){
  const u=new URL(req.url),op=u.searchParams.get('op')||'';
  if(op==='source')return NextResponse.json({
    source:'관세청_수출 주요품목별 10일 단위 잠정치 통계',
    base:BASE,
    itemNames:ITEM_NAMES,
    cadence:'1~10일=11일, 1~20일=21일, 월전체=익월 1일',
    unit:'천 달러'
  },{headers:{'Cache-Control':'no-store'}});
  if(!validToken(requestToken(req)))return unauthorized();
  if(op==='ping')return NextResponse.json({ok:true,itemNames:ITEM_NAMES},{headers:{'Cache-Control':'no-store'}});
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
  if(op==='query'){
    const startDate=String(body.startDate||''),endDate=String(body.endDate||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||startDate>endDate)
      return NextResponse.json({error:'BAD_DATE_RANGE'},{status:400});
    const envKey=process.env.DATA_GO_KR_SERVICE_KEY||process.env.KCS_SERVICE_KEY||process.env.PUBLIC_DATA_SERVICE_KEY||'';
    try{
      const got=await fetchOfficial(String(body.serviceKey||envKey),firstDateOfMonth(startDate),lastDateOfMonth(endDate));
      const rows=enrich(got.rows,startDate,endDate);
      return NextResponse.json({ok:true,rows,itemNames:ITEM_NAMES,unit:'천 달러',endpoint:got.endpoint,diagnostics:got.diagnostics,source:'관세청·공공데이터포털'},{headers:{'Cache-Control':'no-store'}});
    }catch(e:any){
      const msg=String(e?.message||e);
      if(msg==='DATA_GO_KR_KEY_REQUIRED')return NextResponse.json({error:'DATA_GO_KR_KEY_REQUIRED',message:'공공데이터포털 서비스키를 한 번 등록해 주세요.'},{status:428});
      return NextResponse.json({error:'OFFICIAL_API_FAILED',message:msg.slice(0,1800)},{status:502,headers:{'Cache-Control':'no-store'}});
    }
  }
  return NextResponse.json({error:'BAD_OP'},{status:400});
}
