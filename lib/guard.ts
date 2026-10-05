import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { sessionCookieName, verifySession } from './auth';

const BRIDGE_SCOPE='ai-radar-bridge-v1';
function secret(){return process.env.SESSION_SECRET||''}
export function verifyBridgeToken(token?:string|null){
  if(!token||!secret())return false;
  const parts=String(token).split('.');if(parts.length!==3||parts[0]!=='v1')return false;
  const exp=Number(parts[1]);if(!Number.isFinite(exp)||exp<=Date.now()/1000)return false;
  const payload=parts[0]+'.'+parts[1];
  const expected=crypto.createHmac('sha256',secret()+':'+BRIDGE_SCOPE).update(payload).digest('base64url');
  try{return parts[2].length===expected.length&&crypto.timingSafeEqual(Buffer.from(parts[2]),Buffer.from(expected))}catch{return false}
}
export async function isAuthed(req?:Request){
  const jar=await cookies();if(verifySession(jar.get(sessionCookieName)?.value))return true;
  if(req){const h=req.headers.get('authorization')||'';const m=h.match(/^Bearer\s+(.+)$/i);if(m&&verifyBridgeToken(m[1]))return true}
  return false;
}
export async function unauthorized(){return NextResponse.json({error:'인증이 필요합니다.'},{status:401});}
