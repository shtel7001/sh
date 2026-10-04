// @ts-nocheck
import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SCOPE = 'gc-flow-accumulation-radar-20261002-v1';
const ACCESS_CODE_HASH = 'dcf62aebf5b5020c642a92711ca9b135eaaa5524dd31bd43a15d3abb68d46619';
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';

function secret(){ return process.env.SESSION_SECRET || ''; }
function sign(payload){ return crypto.createHmac('sha256', secret()+':'+SCOPE).update(payload).digest('base64url'); }
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
function createToken(){const p=SCOPE+'.'+crypto.randomBytes(24).toString('base64url');return p+'.'+sign(p);}
function unauthorized(){return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers:{'Cache-Control':'no-store'}});}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function ymd(v){return String(v??'').replace(/\D/g,'').slice(0,8);}
function dashDate(v){const s=ymd(v);return /^\d{8}$/.test(s)?s.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):String(v??'');}

async function fetchText(url,timeoutMs=12000){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);
  try{
    const r=await fetch(url,{signal:c.signal,cache:'no-store',headers:{'User-Agent':UA,'Accept':'text/xml,text/plain,*/*','Referer':'https://finance.naver.com/'}});
    if(!r.ok)throw new Error('HTTP_'+r.status);
    return await r.text();
  }finally{clearTimeout(t);}
}

function parseFchart(xml){
  const out=[]; const re=/<item\s+data="([^"]+)"\s*\/?\s*>/g; let m;
  while((m=re.exec(xml))){
    const p=m[1].split('|');
    if(p.length<6)continue;
    const date=ymd(p[0]),open=Number(p[1]),high=Number(p[2]),low=Number(p[3]),close=Number(p[4]),volume=Number(p[5]);
    if(!/^\d{8}$/.test(date)||!Number.isFinite(close))continue;
    out.push({date:dashDate(date),open:Number.isFinite(open)?open:null,high:Number.isFinite(high)?high:null,low:Number.isFinite(low)?low:null,close,volume:Number.isFinite(volume)?volume:0});
  }
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}

export async function GET(req){
  if(!validToken(requestToken(req)))return unauthorized();
  const u=new URL(req.url),op=u.searchParams.get('op')||'';
  if(op==='ping')return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
  if(op==='price'){
    const code=String(u.searchParams.get('code')||'').replace(/\D/g,'').slice(0,6);
    const days=clamp(Math.round(Number(u.searchParams.get('days')||120)),1,120);
    if(!/^\d{6}$/.test(code))return NextResponse.json({error:'BAD_CODE'},{status:400});
    try{
      const count=clamp(days+15,20,150);
      const xml=await fetchText('https://fchart.stock.naver.com/sise.nhn?symbol='+encodeURIComponent(code)+'&timeframe=day&count='+count+'&requestType=0');
      const rows=parseFchart(xml).slice(-days);
      if(!rows.length)throw new Error('PRICE_EMPTY');
      return NextResponse.json({ok:true,code,days,rows},{headers:{'Cache-Control':'no-store'}});
    }catch(e){
      return NextResponse.json({error:'PRICE_FAILED',message:String(e?.message||e)},{status:502,headers:{'Cache-Control':'no-store'}});
    }
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
  return NextResponse.json({error:'BAD_OP'},{status:400});
}
