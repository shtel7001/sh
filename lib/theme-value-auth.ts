import crypto from 'crypto';
import { NextRequest } from 'next/server';

const COOKIE = 'theme_value_auth_v2';
const MAX_AGE = 60 * 60 * 24 * 365 * 10;
const ACCESS_HASH = '09d2a533d6897b868b8763c7d71e95bef51f950ef029e03a14c1e3314b3da0cb';
const FALLBACK_SECRET = 'theme-value-radar-20261001-private-session-v2-9338';

function secret(){
  return process.env.SESSION_SECRET?.trim() || FALLBACK_SECRET;
}

function sign(payload:string){
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function accessCodeMatches(code:string){
  const got = crypto.createHash('sha256').update(String(code || '').trim()).digest('hex');
  try {
    return got.length === ACCESS_HASH.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(ACCESS_HASH));
  } catch {
    return false;
  }
}

export function createThemeValueSession(){
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = `${exp}.themevalue2`;
  return `${payload}.${sign(payload)}`;
}

export function verifyThemeValueSession(token?:string | null){
  if(!token) return false;
  const parts = token.split('.');
  if(parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = sign(payload);
  const sig = parts[2];
  try {
    if(sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  } catch {
    return false;
  }
  const exp = Number(parts[0]);
  return Number.isFinite(exp) && exp > Date.now() / 1000 && parts[1] === 'themevalue2';
}

function bearerToken(req:NextRequest){
  const auth = req.headers.get('authorization') || '';
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
}

export function isThemeValueAuthed(req:NextRequest){
  const headerToken = bearerToken(req);
  if(headerToken && verifyThemeValueSession(headerToken)) return true;
  return verifyThemeValueSession(req.cookies.get(COOKIE)?.value);
}

export const themeValueCookieName = COOKIE;
export const themeValueCookieMaxAge = MAX_AGE;
