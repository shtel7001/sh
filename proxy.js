import {NextResponse} from 'next/server';
import {SESSION_COOKIE,verifySessionToken} from './lib/auth';

export async function proxy(req){
  const p=req.nextUrl.pathname;
  if(p==='/login'||p==='/api/auth/verify'||p==='/api/auth/logout'||p==='/api/auth/bootstrap') return NextResponse.next();
  const token=req.cookies.get(SESSION_COOKIE)?.value;
  if(await verifySessionToken(token)) return NextResponse.next();
  if(p.startsWith('/api/')) return NextResponse.json({ok:false,error:'AUTH_REQUIRED'},{status:401});
  const u=req.nextUrl.clone(); u.pathname='/login'; u.search='';
  return NextResponse.redirect(u);
}

export const config={matcher:['/((?!_next/static|_next/image|favicon.ico).*)']};
