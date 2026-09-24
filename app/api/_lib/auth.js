import crypto from 'crypto';

export const COOKIE_NAME='low_retest_auth';
const ONE_YEAR=365*24*60*60;
const SALT='506e73aa09e86b1eff0a83006e070dc8';
const EXPECTED=Buffer.from('2a50a97085c5bcfebc214dd8b00ce4c3e1959ca9cb21ce7cd361ec9695f8fa89','hex');

function derive(v){
  return crypto.scryptSync(String(v||'').replace(/\D/g,''),SALT,32,{N:16384,r:8,p:1,maxmem:64*1024*1024});
}
export function validCode(v){
  try{return crypto.timingSafeEqual(derive(v),EXPECTED)}catch{return false}
}
export function isAuthed(req){
  const got=req.cookies?.get(COOKIE_NAME)?.value||'';
  return validCode(got);
}
export function setAuthCookie(res,code){
  res.cookies.set(COOKIE_NAME,String(code||'').replace(/\D/g,''),{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:ONE_YEAR});
  return res;
}
