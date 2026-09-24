import crypto from 'crypto';

const AUTH_CODE = '02121885';
const SECRET = '524f872299c959fcacaad7d5a46b11340100efe60177b70ba029c6bc10e80d2a';
export const COOKIE_NAME = 'low_retest_auth';

function token(){return crypto.createHmac('sha256',SECRET).update('low-retest-permanent-v1').digest('hex')}
export function validCode(v){return String(v||'').trim()===AUTH_CODE}
export function isAuthed(req){
  const got=req.cookies?.get(COOKIE_NAME)?.value||''; const exp=token();
  if(got.length!==exp.length)return false;
  try{return crypto.timingSafeEqual(Buffer.from(got),Buffer.from(exp))}catch{return false}
}
export function setAuthCookie(res){
  res.cookies.set(COOKIE_NAME,token(),{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:60*60*24*365*10});
  return res;
}
