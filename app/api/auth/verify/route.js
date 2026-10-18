import {NextResponse} from 'next/server';
import {SESSION_COOKIE,createSessionToken,sessionMaxAge} from '../../../../lib/auth';
export const runtime='nodejs';
export async function POST(req){
 try{
  const {code}=await req.json();
  const expected=process.env.ACCESS_PASSWORD;
  if(!expected)return NextResponse.json({ok:false,error:'AUTH_SERVICE_ERROR'},{status:503});
  const x=new TextEncoder(),a=x.encode(String(code||'')),b=x.encode(expected);
  let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a[i]||0)^(b[i]||0);
  if(diff)return NextResponse.json({ok:false,error:'INVALID_CODE'},{status:401});
  const token=await createSessionToken(),res=NextResponse.json({ok:true});
  res.cookies.set(SESSION_COOKIE,token,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:sessionMaxAge});
  return res;
 }catch{return NextResponse.json({ok:false,error:'AUTH_SERVICE_ERROR'},{status:503})}
}