const enc = new TextEncoder();
export const OTP_ID = 'low-screener-20260924-1058-v1';
export const SESSION_COOKIE = 'lp_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function secret(){
  const s = process.env.SESSION_SECRET;
  if(!s || s.length < 16) throw new Error('SESSION_SECRET is not configured');
  return s;
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
export async function deriveOtp(){
  const sig=await hmac('otp:'+OTP_ID);
  let n=0n;
  for(let i=0;i<8;i++) n=(n<<8n)|BigInt(sig[i]);
  return (n % 10000000000n).toString().padStart(10,'0');
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
export function otpEqual(a,b){ return safeEq(String(a||''),String(b||'')); }
export const sessionMaxAge = Math.floor(SESSION_MS/1000);
