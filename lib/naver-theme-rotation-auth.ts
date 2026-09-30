import crypto from 'crypto';
import { NextRequest } from 'next/server';

const COOKIE='naver_theme_rotation_auth_v1';
const MAX_AGE=60*60*24*365*10;
const ACCESS_HASH='208f2c8ac3f373256ad55dc7dd44880543911cf2857b9cea61725233c85abc8e';
const FALLBACK_SECRET='naver-theme-rotation-radar-20261001-private-session-v1-9338';

function secret(){return process.env.SESSION_SECRET?.trim() || FALLBACK_SECRET;}
function sign(payload:string){return crypto.createHmac('sha256',secret()).update(payload).digest('base64url');}

export function accessCodeMatches(code:string){
  const got=crypto.createHash('sha256').update(String(code||'').trim()).digest('hex');
  try{return crypto.timingSafeEqual(Buffer.from(got),Buffer.from(ACCESS_HASH));}catch{return false;}
}
export function createThemeRotationSession(){
  const exp=Math.floor(Date.now()/1000)+MAX_AGE;
  const payload=`${exp}.naverthemerotation1`;
  return `${payload}.${sign(payload)}`;
}
export function verifyThemeRotationSession(token?:string|null){
  if(!token)return false;
  const p=token.split('.'); if(p.length!==3)return false;
  const payload=`${p[0]}.${p[1]}`, expected=sign(payload), sig=p[2];
  try{if(sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return false;}catch{return false;}
  const exp=Number(p[0]); return Number.isFinite(exp)&&exp>Date.now()/1000&&p[1]==='naverthemerotation1';
}
export function isThemeRotationAuthed(req:NextRequest){return verifyThemeRotationSession(req.cookies.get(COOKIE)?.value);}
export const themeRotationCookieName=COOKIE;
export const themeRotationCookieMaxAge=MAX_AGE;
