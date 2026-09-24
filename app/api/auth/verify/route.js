import {NextResponse} from 'next/server';
import {getCache} from '@vercel/functions';
import {SESSION_COOKIE,createSessionToken,deriveOtp,otpEqual,sessionMaxAge} from '../../../../lib/auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';

function clientKey(req){
  const raw=(req.headers.get('x-forwarded-for')||req.headers.get('x-real-ip')||'unknown').split(',')[0].trim();
  return raw.replace(/[^a-zA-Z0-9:._-]/g,'').slice(0,80)||'unknown';
}

export async function POST(req){
  try{
    const cache=getCache();
    const ip=clientKey(req);
    const failKey='low-screener:auth-fails:'+ip;
    const failures=Number(await cache.get(failKey)||0);
    if(failures>=8) return NextResponse.json({ok:false,error:'TOO_MANY_ATTEMPTS'},{status:429});

    const body=await req.json().catch(()=>({}));
    const code=String(body.code||'').replace(/\D/g,'');
    if(code.length!==6){
      await cache.set(failKey,String(failures+1),{ttl:900});
      return NextResponse.json({ok:false,error:'INVALID_CODE'},{status:401});
    }

    const expected=await deriveOtp();
    if(!otpEqual(code,expected)){
      await cache.set(failKey,String(failures+1),{ttl:900});
      return NextResponse.json({ok:false,error:'INVALID_CODE'},{status:401});
    }

    await cache.set(failKey,'0',{ttl:1});
    const token=await createSessionToken();
    const res=NextResponse.json({ok:true,reusable:true,permanentCode:true,sessionDays:365});
    res.cookies.set(SESSION_COOKIE,token,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:sessionMaxAge});
    return res;
  }catch(e){
    console.error('Auth verify failed',e);
    return NextResponse.json({ok:false,error:'AUTH_SERVICE_ERROR'},{status:503});
  }
}
