import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createHistoricalSession, historicalCookieName, historicalCookieMaxAge, isHistoricalAuthed } from '@/lib/historical-spike-auth';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const HUB_HASH='19e5afe03ed07447185162e747fcabc8128d5d6c0caa2ece63ec3f0382d109fc';
const FLOW_SCOPE='gc-flow-accumulation-radar-20261002-v1';
const D1_SCOPE='d1-theme-spike-radar-v1';
const BRIDGE_SCOPE='ai-radar-bridge-v1';

function secret(){return process.env.SESSION_SECRET||''}
function matches(v:string){
  const got=crypto.createHash('sha256').update(String(v||'').trim()).digest();
  const exp=Buffer.from(HUB_HASH,'hex');
  try{return got.length===exp.length&&crypto.timingSafeEqual(got,exp)}catch{return false}
}
function scopedToken(scope:string){
  const p=scope+'.'+crypto.randomBytes(24).toString('base64url');
  const sig=crypto.createHmac('sha256',secret()+':'+scope).update(p).digest('base64url');
  return p+'.'+sig;
}
function bridgeToken(){
  const exp=Math.floor(Date.now()/1000)+60*60*24*365;
  const payload='v1.'+exp;
  const sig=crypto.createHmac('sha256',secret()+':'+BRIDGE_SCOPE).update(payload).digest('base64url');
  return payload+'.'+sig;
}
export async function GET(req:NextRequest){
  if(!secret())return NextResponse.json({ok:false,error:'AUTH_NOT_CONFIGURED'},{status:503,headers:{'Cache-Control':'no-store'}});
  if(!isHistoricalAuthed(req))return NextResponse.json({ok:false,error:'UNAUTHORIZED'},{status:401,headers:{'Cache-Control':'no-store'}});
  return NextResponse.json({ok:true,bridgeToken:bridgeToken()},{headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
}
export async function POST(req:NextRequest){
  if(!secret())return NextResponse.json({ok:false,error:'AUTH_NOT_CONFIGURED'},{status:503,headers:{'Cache-Control':'no-store'}});
  const body=await req.json().catch(()=>({}));
  if(!matches(String(body?.code||body?.password||'')))return NextResponse.json({ok:false,error:'INVALID_CODE'},{status:401,headers:{'Cache-Control':'no-store'}});
  const res=NextResponse.json({ok:true,flowToken:scopedToken(FLOW_SCOPE),d1Token:scopedToken(D1_SCOPE),bridgeToken:bridgeToken(),deviceLock:HUB_HASH},{headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
  res.cookies.set(historicalCookieName,createHistoricalSession(),{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:historicalCookieMaxAge});
  return res;
}
