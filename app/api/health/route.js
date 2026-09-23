import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function checkNaverUniverse() {
  const r = await fetch('https://m.stock.naver.com/front-api/stock/domestic/stockList?sortType=marketValue&category=KOSPI&page=1&pageSize=3', {
    headers: {
      'User-Agent': 'Mozilla/5.0 low-point-cycle-radar/1.0',
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://m.stock.naver.com/domestic/home/stockList/marketValue',
    },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Naver front-api ${r.status}`);
  const raw = await r.json();
  const payload = raw?.isSuccess === true ? raw.result : raw;
  const rows = Array.isArray(payload) ? payload : (payload?.stocks || []);
  if (!rows.length) throw new Error(`Naver front-api empty${raw?.detailCode ? ` (${raw.detailCode})` : ''}`);
  return rows.slice(0, 3).map(x => ({
    code: x.itemCode || x.stockCode || x.code,
    name: x.stockName || x.itemName || x.name,
    marketValue: x.marketValue ?? x.marketSum ?? x.mks,
  }));
}

async function checkYahooDaily() {
  const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/005930.KS?range=1y&interval=1d&includePrePost=false', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  const j = await r.json();
  const x = j?.chart?.result?.[0];
  const closes = x?.indicators?.quote?.[0]?.close || [];
  const valid = closes.filter(v => Number.isFinite(Number(v)) && Number(v) > 0).map(Number);
  if (valid.length < 20) throw new Error('Yahoo daily parse short');
  return { symbol: '005930.KS', bars: valid.length, lastClose: valid.at(-1) };
}

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    const [naver, yahoo] = await Promise.all([checkNaverUniverse(), checkYahooDaily()]);
    return NextResponse.json({ ok: true, checkedAt, naver, yahoo });
  } catch (e) {
    return NextResponse.json({ ok: false, checkedAt, error: String(e?.message || e) }, { status: 500 });
  }
}
