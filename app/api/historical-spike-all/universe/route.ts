import { NextRequest, NextResponse } from 'next/server';
import { isHistoricalAuthed } from '@/lib/historical-spike-auth';
import { jfetch, num } from '@/lib/historical-spike-naver';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

type Market = 'KOSPI' | 'KOSDAQ';

function pickRows(data: any): any[] {
  if (Array.isArray(data)) return data;
  for (const key of ['stocks', 'stockList', 'items', 'data', 'result']) {
    const value = data?.[key];
    if (Array.isArray(value)) return value;
  }
  if (Array.isArray(data?.result?.stocks)) return data.result.stocks;
  if (Array.isArray(data?.result?.items)) return data.result.items;
  return [];
}

async function fetchPage(market: Market, page: number) {
  try {
    const data = await jfetch(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=100`, 12000);
    return pickRows(data);
  } catch {
    const data = await jfetch(`https://m.stock.naver.com/api/stock/domestic/stockList?sortType=marketValue&category=${market}&page=${page}&pageSize=100`, 12000);
    return pickRows(data);
  }
}

function normalize(r: any, market: Market, rank: number) {
  const code = String(r?.itemCode ?? r?.itemcode ?? r?.stockCode ?? r?.code ?? '').match(/\d{6}/)?.[0] || '';
  const name = String(r?.stockName ?? r?.name ?? r?.itemName ?? '').trim();
  if (!code || !name) return null;
  return {
    code,
    name,
    market,
    rank,
    currentPrice: num(r?.closePrice ?? r?.currentPrice ?? r?.nv),
    currentChange: num(r?.fluctuationsRatio ?? r?.changeRate ?? r?.cr),
    marketValueRaw: r?.marketValue ?? r?.marketCap ?? r?.mks ?? null,
    marketValue: num(r?.marketValue ?? r?.marketCap ?? r?.mks),
  };
}

async function fetchMarketAll(market: Market) {
  const out: any[] = [];
  const seen = new Set<string>();
  const maxPages = market === 'KOSPI' ? 20 : 30;

  for (let page = 1; page <= maxPages; page++) {
    const rows = await fetchPage(market, page);
    if (!rows.length) break;

    let added = 0;
    for (const r of rows) {
      const row = normalize(r, market, out.length + 1);
      if (!row || seen.has(row.code)) continue;
      seen.add(row.code);
      out.push(row);
      added++;
    }

    if (!added || rows.length < 100) break;
  }

  const minimum = market === 'KOSPI' ? 700 : 1000;
  if (out.length < minimum) throw new Error(`${market} 전종목 목록 수집이 불완전합니다. (${out.length}종목)`);
  return out.map((x, i) => ({ ...x, rank: i + 1 }));
}

export async function GET(req: NextRequest) {
  if (!isHistoricalAuthed(req)) {
    return NextResponse.json({ ok: false, error: 'AUTH_REQUIRED' }, { status: 401 });
  }

  try {
    const requested = String(req.nextUrl.searchParams.get('market') || 'ALL').toUpperCase();
    let kospi: any[] = [];
    let kosdaq: any[] = [];

    if (requested === 'KOSPI') kospi = await fetchMarketAll('KOSPI');
    else if (requested === 'KOSDAQ') kosdaq = await fetchMarketAll('KOSDAQ');
    else [kospi, kosdaq] = await Promise.all([fetchMarketAll('KOSPI'), fetchMarketAll('KOSDAQ')]);

    return NextResponse.json(
      { ok: true, kospi, kosdaq, counts: { kospi: kospi.length, kosdaq: kosdaq.length }, scope: 'ALL_LISTED' },
      { headers: { 'Cache-Control': 'private, max-age=1800' } },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
