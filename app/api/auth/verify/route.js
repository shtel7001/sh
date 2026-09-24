import {NextResponse} from 'next/server';
import {getCache} from '@vercel/functions';
import {OTP_ID,SESSION_COOKIE,createSessionToken,deriveOtp,otpEqual,sessionMaxAge} from '../../../../lib/auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';

const USED_KEY='low-screener:otp-used:'+OTP_ID;
const ttlYear=365*24*60*60;

function clientKey(req){
  const raw=(req.headers.get('x-forwarded-for')||req.headers.get('x-real-ip')||'unknown').split(',')[0].trim();
  return raw.replace(/[^a-zA-Z0-9:._-]/g,'').slice(0,80)||'unknown';
}

export async function POST(req){
  try{
    const cache=getCache();
    const ip=clientKey(req);
    const failKey='low-screener:otp-fails:'+ip;
    const failures=Number(await cache.get(failKey)||0);
    if(failures>=8) return NextResponse.json({ok:false,error:'TOO_MANY_ATTEMPTS'},{status:429});

    const body=await req.json().catch(()=>({}));
    const code=String(body.code||'').replace(/\D/g,'');
    if(code.length!==10){
      await cache.set(failKey,String(failures+1),{ttl:900});
      return NextResponse.json({ok:false,error:'INVALID_CODE'},{status:401});
    }

    if(await cache.get(USED_KEY)) return NextResponse.json({ok:false,error:'CODE_ALREADY_USED'},{status:409});
    const expected=await deriveOtp();
    if(!otpEqual(code,expected)){
      await cache.set(failKey,String(failures+1),{ttl:900});
      return NextResponse.json({ok:false,error:'INVALID_CODE'},{status:401});
    }

    // Runtime Cache를 사용해 모든 함수 인스턴스가 같은 사용 기록을 보도록 합니다.
    // 동시 입력 충돌 시 마지막 claim 하나만 통과하도록 재확인합니다.
    const claim=crypto.randomUUID();
    await cache.set(USED_KEY,claim,{ttl:ttlYear});
    await new Promise(r=>setTimeout(r,180));
    const winner=String(await cache.get(USED_KEY)||'');
    if(winner!==claim) return NextResponse.json({ok:false,error:'CODE_ALREADY_USED'},{status:409});

    const token=await createSessionToken();
    const res=NextResponse.json({ok:true});
    res.cookies.set(SESSION_COOKIE,token,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:sessionMaxAge});
    return res;
  }catch(e){
    console.error('OTP verify failed',e);
    return NextResponse.json({ok:false,error:'AUTH_SERVICE_ERROR'},{status:503});
  }
}
