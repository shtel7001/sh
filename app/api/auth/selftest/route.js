import {NextResponse} from 'next/server';
import {getCache} from '@vercel/functions';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
  try{
    const cache=getCache();
    const key='low-screener:auth-selftest';
    const value=crypto.randomUUID();
    await cache.set(key,value,{ttl:60});
    const read=String(await cache.get(key)||'');
    return NextResponse.json({ok:read===value,cache:read===value?'read-write-ok':'mismatch'});
  }catch(e){return NextResponse.json({ok:false,error:String(e?.message||e)},{status:500});}
}
