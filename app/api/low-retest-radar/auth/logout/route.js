import {NextResponse} from 'next/server';import {COOKIE_NAME} from '../../_lib/auth';
export const runtime='nodejs';export function POST(){const r=NextResponse.json({ok:true});r.cookies.set(COOKIE_NAME,'',{path:'/',maxAge:0});return r}
