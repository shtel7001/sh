import {NextResponse} from 'next/server';
import {validCode,setAuthCookie} from '../../_lib/auth';
export const runtime='nodejs';
export async function POST(req){
  try{const b=await req.json();if(!validCode(b?.code))return NextResponse.json({ok:false,error:'INVALID_CODE'},{status:401});return setAuthCookie(NextResponse.json({ok:true}));}
  catch{return NextResponse.json({ok:false,error:'BAD_REQUEST'},{status:400})}
}
