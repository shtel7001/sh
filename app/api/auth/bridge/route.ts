import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createSessionToken, sessionCookieName, sessionMaxAge } from '@/lib/auth';

export const runtime='nodejs';
const BRIDGE_SCOPE='ai-radar-bridge-v1';
function secret(){return process.env.SESSION_SECRET||''}
function verifyBridgeToken(token:string){
  if(!secret())return false;
  const parts=String(token||'').split('.');
  if(parts.length!==3||parts[0]!=='v1')return false;
  const exp=Number(parts[1]);if(!Number.isFinite(exp)||exp<=Date.now()/1000)return false;
  const payload=parts[0]+'.'+parts[1];
  const expected=crypto.createHmac('sha256',secret()+':'+BRIDGE_SCOPE).update(payload).digest('base64url');
  try{return parts[2].length===expected.length&&crypto.timingSafeEqual(Buffer.from(parts[2]),Buffer.from(expected))}catch{return false}
}
export async function POST(req:Request){
  const {token}=await req.json().catch(()=>({token:''}));
  if(!verifyBridgeToken(String(token||'')))return NextResponse.json({ok:false,error:'INVALID_BRIDGE_TOKEN'},{status:401});
  const res=NextResponse.json({ok:true});
  res.cookies.set(sessionCookieName,createSessionToken(),{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:sessionMaxAge});
  return res;
}
