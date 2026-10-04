import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let originStatus:number|null = null;
  let originOk = false;
  try {
    const r = await fetch('https://trade.aljal.kr/', {
      cache:'no-store',
      headers:{'user-agent':'Mozilla/5.0 (compatible; KTradeFlowHealth/1.0)'},
      signal:AbortSignal.timeout(10000)
    });
    originStatus = r.status;
    originOk = r.ok;
  } catch {}
  return NextResponse.json({
    ok:Boolean(process.env.RADAR_PASSWORD && process.env.SESSION_SECRET && originOk),
    authConfigured:Boolean(process.env.RADAR_PASSWORD && (process.env.SESSION_SECRET||'').length>=24),
    originOk,
    originStatus,
    checkedAt:new Date().toISOString()
  },{headers:{'cache-control':'no-store'}});
}
