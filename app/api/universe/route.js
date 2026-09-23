import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const n = (v) => {
  if (v == null) return null;
  const x = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(x) ? x : null;
};

async function frontPage(market, page, pageSize = 100) {
  const category = market === 'kosdaq' ? 'KOSDAQ' : 'KOSPI';
  const url = new URL('https://m.stock.naver.com/front-api/stock/domestic/stockList');
  url.searchParams.set('sortType', 'marketValue');
  url.searchParams.set('category', category);
  url.searchParams.set('page', String(page));
  url.searchParams.set('pageSize', String(pageSize));
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 low-point-cycle-radar/1.0',
      Accept: 'application/json, text/plain, */*',
      Referer: `https://m.stock.naver.com/domestic/home/stockList/marketValue`,
    },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Naver front-api ${r.status}`);
  const raw = await r.json();
  let payload = raw;
  if (raw && typeof raw === 'object' && 'isSuccess' in raw) {
    if (raw.isSuccess !== true) throw new Error(`Naver front-api failed: ${raw.detailCode || raw.code || 'unknown'}`);
    payload = raw.result;
  }
  const rows = Array.isArray(payload) ? payload : (payload?.stocks || []);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Naver front-api returned no stocks');
  return rows;
}

function normalize(row, market, rank) {
  const code = String(row.itemCode || row.stockCode || row.code || '').replace(/\D/g, '').padStart(6, '0').slice(-6);
  if (!/^\d{6}$/.test(code)) return null;
  const name = String(row.stockName || row.itemName || row.name || code).trim();
  const current = n(row.closePrice ?? row.currentPrice ?? row.nv);
  const marketCapEok = n(row.marketValue ?? row.marketSum ?? row.mks);
  return {
    rank,
    code,
    name,
    current,
    marketCapEok,
    market: market === 'kosdaq' ? 'KOSDAQ' : 'KOSPI',
    yahoo: `${code}.${market === 'kosdaq' ? 'KQ' : 'KS'}`,
  };
}

export async function GET(req) {
  try {
    const s = new URL(req.url).searchParams;
    const market = s.get('market') === 'kosdaq' ? 'kosdaq' : 'kospi';
    const limit = Math.min(500, Math.max(1, Number(s.get('limit') || 500)));
    const pageSize = 100;
    const all = [];
    const seen = new Set();
    for (let p = 1; p <= Math.ceil(limit / pageSize) + 1 && all.length < limit; p++) {
      const rows = await frontPage(market, p, pageSize);
      for (const row of rows) {
        const item = normalize(row, market, all.length + 1);
        if (!item || seen.has(item.code)) continue;
        seen.add(item.code);
        all.push(item);
        if (all.length >= limit) break;
      }
      if (rows.length < pageSize) break;
    }
    if (!all.length) throw new Error('종목 목록을 가져오지 못했습니다.');
    return NextResponse.json({ ok: true, source: 'Naver front-api marketValue', items: all, count: all.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
