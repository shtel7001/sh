import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clean(s='') {
  return String(s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

async function checkNaverUniverse() {
  const r = await fetch('https://finance.naver.com/sise/sise_market_sum.naver?sosok=0&page=1', {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ko-KR,ko;q=0.9' },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Naver ${r.status}`);
  const html = await r.text();
  const items = [];
  for (const m of html.matchAll(/href="\/item\/main\.naver\?code=(\d{6})"[^>]*>([^<]+)<\/a>/g)) {
    items.push({ code: m[1], name: clean(m[2]) });
    if (items.length >= 3) break;
  }
  if (!items.length) throw new Error('Naver parse empty');
  return items;
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
  return { bars: valid.length, lastClose: valid.at(-1) };
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
