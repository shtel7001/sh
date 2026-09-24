import {NextResponse} from 'next/server';
import {deriveOtp,OTP_ID} from '../../../lib/auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
  const code=await deriveOtp();
  return NextResponse.json({ok:true,id:OTP_ID,code});
}
