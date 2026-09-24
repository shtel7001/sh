import crypto from 'node:crypto';
const id='kr-low-screener-all-20260924-1122-v1';
const secret=process.env.SESSION_SECRET;
if(!secret||secret.length<16){console.log('[OTP-BOOTSTRAP] SESSION_SECRET unavailable');process.exit(0);}
const d=crypto.createHmac('sha256',secret).update('otp:'+id).digest();
let n=0n;for(let i=0;i<8;i++)n=(n<<8n)|BigInt(d[i]);
console.log('[OTP-BOOTSTRAP] '+(n%1000000n).toString().padStart(6,'0'));
