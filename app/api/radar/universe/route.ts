import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';
import { fetchUniverse } from '@/lib/market';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  if (!(await isAuthed())) return unauthorized();
  const started = Date.now();
  try {
    const got = await fetchUniverse();
    const stocks = got.stocks.filter((s) => s.market === 'KOSPI').slice(0, 500).map((s, i) => ({
      rank: i + 1,
      name: s.name,
      code: s.code,
      market: 'KOSPI' as const,
      currentPrice: s.currentPrice,
      marketCap: s.marketCap,
    }));
    if (stocks.length < 400) {
      return NextResponse.json({
        error: `KOSPI 종목목록이 ${stocks.length}개만 수집되었습니다. 잠시 후 다시 시도해 주세요.`,
        stocks,
        sources: got.sources,
        warnings: got.errors,
      }, { status: 503 });
    }
    return NextResponse.json({
      ok: true,
      stocks,
      count: stocks.length,
      sources: got.sources,
      warnings: got.errors,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'KOSPI 500 수집 실패' }, { status: 502 });
  }
}
