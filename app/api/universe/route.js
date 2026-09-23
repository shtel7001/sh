import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function daumPage(market, page, perPage = 100) {
  const m = market === 'kosdaq' ? 'KOSDAQ' : 'KOSPI';
  const url = new URL('https://finance.daum.net/api/trend/market_capitalization');
  url.searchParams.set('page', String(page));
  url.searchParams.set('perPage', String(perPage));
  url.searchParams.set('fieldName', 'marketCap');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('market', m);
  url.searchParams.set('pagination', 'true');
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 low-point-cycle-radar/1.0',
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://finance.daum.net/domestic/market_cap',
    },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Daum ${m} ${r.status}`);
  const j = await r.json();
  const rows = Array.isArray(j?.data) ? j.data : [];
  if (!rows.length) throw new Error(`Daum ${m} returned no stocks`);
  return rows;
}

function normalize(row, market, fallbackRank) {
  const code = String(row.symbolCode || '').replace(/^A/, '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) return null;
  const marketCapWon = Number(row.marketCap);
  return {
    rank: Number(row.rank) || fallbackRank,
    code,
    name: String(row.name || code),
    current: Number(row.tradePrice) || null,
    marketCapEok: Number.isFinite(marketCapWon) ? Math.round(marketCapWon / 100000000) : null,
    market: market === 'kosdaq' ? 'KOSDAQ' : 'KOSPI',
    yahoo: `${code}.${market === 'kosdaq' ? 'KQ' : 'KS'}`,
  };
}

export async function GET(req) {
  try {
    const s = new URL(req.url).searchParams;
    const market = s.get('market') === 'kosdaq' ? 'kosdaq' : 'kospi';
    const limit = Math.min(500, Math.max(1, Number(s.get('limit') || 500)));
    const perPage = 100;
    const all = [];
    const seen = new Set();
    for (let p = 1; p <= Math.ceil(limit / perPage) + 1 && all.length < limit; p++) {
      const rows = await daumPage(market, p, perPage);
      for (const row of rows) {
        const item = normalize(row, market, all.length + 1);
        if (!item || seen.has(item.code)) continue;
        seen.add(item.code);
        all.push(item);
        if (all.length >= limit) break;
      }
      if (rows.length < perPage) break;
    }
    all.sort((a, b) => a.rank - b.rank);
    if (!all.length) throw new Error('종목 목록을 가져오지 못했습니다.');
    return NextResponse.json({ ok: true, source: 'Daum market capitalization', items: all.slice(0, limit), count: Math.min(limit, all.length) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
