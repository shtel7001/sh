import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const common = {
  'User-Agent': 'Mozilla/5.0 low-point-cycle-radar/1.0',
  Accept: 'application/json, text/plain, */*',
};

async function checkDaumUniverse(market) {
  const u = new URL('https://finance.daum.net/api/trend/market_capitalization');
  u.searchParams.set('page', '1');
  u.searchParams.set('perPage', '3');
  u.searchParams.set('fieldName', 'marketCap');
  u.searchParams.set('order', 'desc');
  u.searchParams.set('market', market);
  u.searchParams.set('pagination', 'true');
  const r = await fetch(u, {
    headers: { ...common, Referer: 'https://finance.daum.net/domestic/market_cap' },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Daum ${market} ${r.status}`);
  const j = await r.json();
  const rows = j?.data || [];
  if (!rows.length) throw new Error(`Daum ${market} empty`);
  return rows.slice(0, 3).map(x => ({ code: x.symbolCode, name: x.name, marketCap: x.marketCap }));
}

async function checkYahooDaily() {
  const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/005930.KS?range=2y&interval=1d&includePrePost=false&events=div%2Csplits', {
    headers: common,
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  const j = await r.json();
  const x = j?.chart?.result?.[0];
  const q = x?.indicators?.quote?.[0] || {};
  const c = x?.indicators?.adjclose?.[0]?.adjclose || q.close || [];
  const valid = c.filter(v => Number.isFinite(Number(v)) && Number(v) > 0);
  if (valid.length < 240) throw new Error(`Yahoo only ${valid.length} bars`);
  return { symbol: '005930.KS', bars: valid.length, lastClose: Number(valid.at(-1)) };
}

async function checkDaumDaily() {
  const r = await fetch('https://finance.daum.net/api/charts/A005930/days?limit=250&adjusted=true', {
    headers: { ...common, Referer: 'https://finance.daum.net/quotes/A005930' },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Daum chart ${r.status}`);
  const j = await r.json();
  const rows = (j?.data || []).filter(x => Number.isFinite(Number(x.tradePrice)) && Number(x.tradePrice) > 0);
  if (rows.length < 200) throw new Error(`Daum chart only ${rows.length} bars`);
  return { symbol: 'A005930', bars: rows.length, lastClose: Number(rows.at(-1)?.tradePrice) };
}

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    const [kospi, kosdaq, yahoo, daumDaily] = await Promise.all([
      checkDaumUniverse('KOSPI'),
      checkDaumUniverse('KOSDAQ'),
      checkYahooDaily(),
      checkDaumDaily(),
    ]);
    return NextResponse.json({ ok: true, checkedAt, kospi, kosdaq, yahoo, daumDaily });
  } catch (e) {
    return NextResponse.json({ ok: false, checkedAt, error: String(e?.message || e) }, { status: 500 });
  }
}
