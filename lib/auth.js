const enc = new TextEncoder();
export const OTP_ID = 'kr-low-screener-all-20260924-1122-v2';
export const SESSION_COOKIE = 'kr_lp_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const OTP_ITERATIONS = 450000;
const OTP_SALT_HEX = '7d508bf051c97b287f02fe828227f7cb';
const OTP_HASH_HEX = 'b43a0db12d909a4c79f7f5f4004205e12f0e4af7ca0f9eed127818a689e74c81';

function secret(){
  const s = process.env.SESSION_SECRET;
  if(!s || s.length < 16) throw new Error('SESSION_SECRET is not configured');
  return s;
}
function hexBytes(s){
  const out=new Uint8Array(s.length/2);
  for(let i=0;i<out.length;i++) out[i]=parseInt(s.slice(i*2,i*2+2),16);
  return out;
}
function bytesEq(a,b){
  if(!a||!b||a.length!==b.length) return false;
  let x=0; for(let i=0;i<a.length;i++) x|=a[i]^b[i]; return x===0;
}
export async function verifyOtp(code){
  const clean=String(code||'').replace(/\D/g,'');
  if(clean.length!==8) return false;
  const key=await crypto.subtle.importKey('raw',enc.encode(clean),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:hexBytes(OTP_SALT_HEX),iterations:OTP_ITERATIONS},key,256);
  return bytesEq(new Uint8Array(bits),hexBytes(OTP_HASH_HEX));
}
function b64u(bytes){
  let s='';
  for(const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function fromB64u(s){
  s=s.replace(/-/g,'+').replace(/_/g,'/');
  while(s.length%4) s+='=';
  const raw=atob(s), out=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i);
  return out;
}
async function hmac(data){
  const key=await crypto.subtle.importKey('raw',enc.encode(secret()),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,enc.encode(data));
  return new Uint8Array(sig);
}
function safeEq(a,b){
  if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length) return false;
  let x=0; for(let i=0;i<a.length;i++) x|=a.charCodeAt(i)^b.charCodeAt(i); return x===0;
}
export async function createSessionToken(){
  const now=Date.now();
  const payload={v:1,iat:now,exp:now+SESSION_MS,jti:crypto.randomUUID()};
  const body=b64u(enc.encode(JSON.stringify(payload)));
  const sig=b64u(await hmac('session:'+body));
  return body+'.'+sig;
}
export async function verifySessionToken(token){
  try{
    if(!token||!token.includes('.')) return false;
    const [body,sig]=token.split('.');
    if(!body||!sig) return false;
    const expected=b64u(await hmac('session:'+body));
    if(!safeEq(sig,expected)) return false;
    const payload=JSON.parse(new TextDecoder().decode(fromB64u(body)));
    return payload&&payload.v===1&&Number(payload.exp)>Date.now();
  }catch{return false;}
}
export const sessionMaxAge = Math.floor(SESSION_MS/1000);
