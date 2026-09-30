import { NextRequest, NextResponse } from 'next/server';
import { accessCodeMatches,createThemeRotationSession,themeRotationCookieMaxAge,themeRotationCookieName } from '@/lib/naver-theme-rotation-auth';
export const runtime='nodejs';
export async function POST(req:NextRequest){
  let body:any={}; try{body=await req.json();}catch{}
  if(!accessCodeMatches(body?.code))return NextResponse.json({ok:false,message:'인증번호가 올바르지 않습니다.'},{status:401});
  const res=NextResponse.json({ok:true});
  res.cookies.set(themeRotationCookieName,createThemeRotationSession(),{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:themeRotationCookieMaxAge});
  return res;
}
