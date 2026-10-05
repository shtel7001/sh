import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createHistoricalSession, historicalCookieName, historicalCookieMaxAge } from '@/lib/historical-spike-auth';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const HUB_HASH='19e5afe03ed07447185162e747fcabc8128d5d6c0caa2ece63ec3f0382d109fc';
const FLOW_SCOPE='gc-flow-accumulation-radar-20261002-v1';
const D1_SCOPE='d1-theme-spike-radar-v1';

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
export async function POST(req:NextRequest){
  if(!secret())return NextResponse.json({ok:false,error:'AUTH_NOT_CONFIGURED'},{status:503,headers:{'Cache-Control':'no-store'}});
  const body=await req.json().catch(()=>({}));
  if(!matches(String(body?.code||body?.password||'')))return NextResponse.json({ok:false,error:'INVALID_CODE'},{status:401,headers:{'Cache-Control':'no-store'}});
  const res=NextResponse.json({ok:true,flowToken:scopedToken(FLOW_SCOPE),d1Token:scopedToken(D1_SCOPE),deviceLock:HUB_HASH},{headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
  res.cookies.set(historicalCookieName,createHistoricalSession(),{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:historicalCookieMaxAge});
  return res;
}
