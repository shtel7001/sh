import crypto from 'crypto';
import { NextRequest } from 'next/server';

const COOKIE = 'hist_spike_auth_v1';
const MAX_AGE = 60 * 60 * 24 * 365 * 10;
const ACCESS_HASH = '5bba0e6923ac3cb62e5a75a2645405009fa79e3c28d378446928002e690f74b3';

function secret(){ return process.env.SESSION_SECRET || ''; }
function sign(payload:string){ return crypto.createHmac('sha256', secret()).update(payload).digest('base64url'); }

export function accessCodeMatches(code:string){
  const got = crypto.createHash('sha256').update(String(code||'').trim()).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(ACCESS_HASH)); } catch { return false; }
}
export function createHistoricalSession(){
  const exp = Math.floor(Date.now()/1000) + MAX_AGE;
  const payload = `${exp}.hist1`;
  return `${payload}.${sign(payload)}`;
}
export function verifyHistoricalSession(token?:string|null){
  if(!token || !secret()) return false;
  const parts=token.split('.');
  if(parts.length!==3) return false;
  const payload=`${parts[0]}.${parts[1]}`; const sig=parts[2]; const expected=sign(payload);
  try { if(sig.length!==expected.length || !crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return false; } catch { return false; }
  const exp=Number(parts[0]); return Number.isFinite(exp) && exp>Date.now()/1000 && parts[1]==='hist1';
}
export function isHistoricalAuthed(req:NextRequest){ return verifyHistoricalSession(req.cookies.get(COOKIE)?.value); }
export const historicalCookieName=COOKIE;
export const historicalCookieMaxAge=MAX_AGE;
