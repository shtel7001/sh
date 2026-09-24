import crypto from 'crypto';

const OTP_ID='low-screener-20260924-1058-v2';
export const COOKIE_NAME='low_retest_auth';
const ONE_YEAR=365*24*60*60;

function secret(){
  const s=process.env.SESSION_SECRET;
  if(!s || s.length<16) throw new Error('SESSION_SECRET is not configured');
  return s;
}
function hmac(data){return crypto.createHmac('sha256',secret()).update(data).digest()}
function expectedCode(){
  const sig=hmac('otp:'+OTP_ID);let n=0n;
  for(let i=0;i<8;i++)n=(n<<8n)|BigInt(sig[i]);
  return (n%1000000n).toString().padStart(6,'0');
}
function safeEq(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
function token(){return crypto.createHmac('sha256',secret()).update('session:'+OTP_ID).digest('hex')}
export function validCode(v){return safeEq(String(v||'').replace(/\D/g,''),expectedCode())}
export function isAuthed(req){const got=req.cookies?.get(COOKIE_NAME)?.value||'';let exp;try{exp=token()}catch{return false}return safeEq(got,exp)}
export function setAuthCookie(res){res.cookies.set(COOKIE_NAME,token(),{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:ONE_YEAR});return res}
