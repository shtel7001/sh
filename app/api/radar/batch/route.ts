import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { isAuthed, unauthorized } from '@/lib/guard';
import { fetchYahooBars, type Bar } from '@/lib/market';

export const runtime = 'nodejs';
export const maxDuration = 60;

type StockInput = {
  name: string;
  code: string;
  market: 'KOSPI';
  currentPrice?: number | null;
  marketCap?: number | null;
};

type NewsItem = { title: string; link: string; publishedAt: string | null };

type RowResult = StockInput & {
  ok: boolean;
  error?: string;
  latestDate?: string;
  close?: number;
  latestChangePct?: number;
  volumeRatio?: number;
  momentum3Pct?: number;
  momentum5Pct?: number;
  ma5?: number;
  ma20?: number;
  spikeCount: number;
  spikes: { date: string; pct: number; preNews: 'YES' | 'NO' | 'UNKNOWN'; leadDays: number | null; headline: string | null }[];
  baseScore: number;
  score: number;
  reasons: string[];
  newsStatus: 'OK' | 'SKIPPED' | 'ERROR';
  newsSource?: string;
  recentNewsCount: number;
  latestNews: NewsItem[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number, d = 2) => Number(n.toFixed(d));

function stripHtml(s: string) {
  return cheerio.load(`<div>${s}</div>`).text().replace(/\s+/g, ' ').trim();
}

function dateOnly(v: string | Date) {
  const d = typeof v === 'string' ? new Date(v) : v;
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

function dayDiff(a: string, b: string) {
  const da = new Date(`${a}T12:00:00Z`).getTime();
  const db = new Date(`${b}T12:00:00Z`).getTime();
  return Math.round((db - da) / 86400000);
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeout = 7000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchNaverOpenApi(name: string): Promise<NewsItem[] | null> {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return null;
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(name)}&display=30&sort=date`;
  const r = await fetchWithTimeout(url, {
    headers: {
      'X-Naver-Client-Id': id,
      'X-Naver-Client-Secret': secret,
      'User-Agent': 'Mozilla/5.0',
    },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Naver API HTTP ${r.status}`);
  const j = await r.json();
  return (Array.isArray(j?.items) ? j.items : []).map((x: any) => ({
    title: stripHtml(String(x?.title || '')),
    link: String(x?.originallink || x?.link || ''),
    publishedAt: dateOnly(String(x?.pubDate || '')),
  })).filter((x: NewsItem) => x.title && x.link);
}

async function fetchNaverFinanceNews(code: string): Promise<NewsItem[]> {
  const url = `https://finance.naver.com/item/news_news.naver?code=${encodeURIComponent(code)}&page=1&sm=title_entity_id.basic&clusterId=`;
  const r = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      Referer: `https://finance.naver.com/item/main.naver?code=${code}`,
    },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Naver Finance HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  const html = ct.includes('utf-8') ? buf.toString('utf8') : iconv.decode(buf, 'EUC-KR');
  const $ = cheerio.load(html);
  const out: NewsItem[] = [];
  $('tr').each((_, tr) => {
    const a = $(tr).find('a[href*="news_read.naver"], a[href*="news.naver.com"], a.tit').first();
    if (!a.length) return;
    const title = a.text().replace(/\s+/g, ' ').trim();
    if (!title) return;
    let href = a.attr('href') || '';
    if (href.startsWith('/')) href = `https://finance.naver.com${href}`;
    const txt = $(tr).text().replace(/\s+/g, ' ').trim();
    const m = txt.match(/(20\d{2})[.\-/](\d{2})[.\-/](\d{2})/);
    const publishedAt = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    if (href) out.push({ title, link: href, publishedAt });
  });
  return [...new Map(out.map((x) => [x.link || x.title, x])).values()].slice(0, 30);
}

async function fetchNews(name: string, code: string) {
  try {
    const api = await fetchNaverOpenApi(name);
    if (api) return { items: api, source: 'NAVER_OPEN_API' };
  } catch {
    // Finance page fallback below.
  }
  const items = await fetchNaverFinanceNews(code);
  return { items, source: 'NAVER_FINANCE' };
}

function pct(a: number, b: number) {
  return a ? ((b / a) - 1) * 100 : 0;
}

function avg(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function analyzeBars(stock: StockInput, bars: Bar[], lookbackDays: number, spikePct: number): RowResult {
  const b = bars.slice(-Math.max(35, lookbackDays + 25));
  if (b.length < 25) throw new Error('가격 이력 부족');
  const last = b[b.length - 1];
  const prev = b[b.length - 2];
  const closes = b.map((x) => x.close);
  const vols = b.map((x) => x.volume);
  const ma5 = avg(closes.slice(-5));
  const ma20 = avg(closes.slice(-20));
  const vol20 = avg(vols.slice(-21, -1));
  const volumeRatio = vol20 > 0 ? last.volume / vol20 : 0;
  const latestChangePct = pct(prev.close, last.close);
  const momentum3Pct = b.length >= 4 ? pct(b[b.length - 4].close, last.close) : 0;
  const momentum5Pct = b.length >= 6 ? pct(b[b.length - 6].close, last.close) : 0;
  const high20 = Math.max(...b.slice(-20).map((x) => x.high));
  const highDistancePct = high20 > 0 ? ((high20 - last.close) / high20) * 100 : 100;
  const vol3 = avg(vols.slice(-3));
  const vol3Ratio = vol20 > 0 ? vol3 / vol20 : 0;

  const scan = b.slice(-Math.min(lookbackDays + 1, b.length));
  const spikes: RowResult['spikes'] = [];
  for (let i = 1; i < scan.length; i++) {
    const d = pct(scan[i - 1].close, scan[i].close);
    if (d >= spikePct) spikes.push({ date: scan[i].date, pct: round(d), preNews: 'UNKNOWN', leadDays: null, headline: null });
  }

  let score = 0;
  const reasons: string[] = [];
  if (volumeRatio >= 3) { score += 25; reasons.push(`거래량 ${round(volumeRatio, 1)}배`); }
  else if (volumeRatio >= 2) { score += 20; reasons.push(`거래량 ${round(volumeRatio, 1)}배`); }
  else if (volumeRatio >= 1.5) { score += 15; reasons.push(`거래량 ${round(volumeRatio, 1)}배`); }
  else if (volumeRatio >= 1.2) { score += 8; reasons.push(`거래량 ${round(volumeRatio, 1)}배`); }

  if (latestChangePct >= 0 && latestChangePct <= 4) { score += 12; reasons.push(`당일 +${round(latestChangePct)}%`); }
  else if (latestChangePct > -1.5 && latestChangePct < 0) { score += 6; reasons.push('얕은 조정'); }
  else if (latestChangePct > 4 && latestChangePct <= 7) { score += 5; reasons.push('강한 당일 모멘텀'); }

  if (last.close > ma5) { score += 10; reasons.push('5일선 위'); }
  if (ma5 > ma20) { score += 10; reasons.push('5일선>20일선'); }
  if (momentum3Pct > 0 && momentum3Pct <= 8) { score += 10; reasons.push(`3일 +${round(momentum3Pct)}%`); }
  else if (momentum3Pct > 8 && momentum3Pct <= 15) { score += 5; reasons.push(`3일 +${round(momentum3Pct)}%`); }
  if (highDistancePct <= 5) { score += 8; reasons.push('20일 고점 5% 이내'); }
  if (vol3Ratio >= 1.3) { score += 10; reasons.push('3일 거래량 증가'); }
  if (spikes.length) { score += 5; reasons.push(`${lookbackDays}일내 ${spikePct}%↑ ${spikes.length}회`); }
  if (latestChangePct > 8 || momentum5Pct > 20) { score -= 12; reasons.push('단기 과열 감점'); }

  score = clamp(Math.round(score), 0, 85);
  return {
    ...stock,
    ok: true,
    latestDate: last.date,
    close: Math.round(last.close),
    latestChangePct: round(latestChangePct),
    volumeRatio: round(volumeRatio, 2),
    momentum3Pct: round(momentum3Pct),
    momentum5Pct: round(momentum5Pct),
    ma5: Math.round(ma5),
    ma20: Math.round(ma20),
    spikeCount: spikes.length,
    spikes: spikes.slice(-8).reverse(),
    baseScore: score,
    score,
    reasons,
    newsStatus: 'SKIPPED',
    recentNewsCount: 0,
    latestNews: [],
  };
}

function attachNews(row: RowResult, news: NewsItem[], newsLeadDays: number, source: string) {
  const today = new Date().toISOString().slice(0, 10);
  const recentNews = news.filter((n) => n.publishedAt && dayDiff(n.publishedAt, today) >= 0 && dayDiff(n.publishedAt, today) <= 3);
  row.latestNews = news.slice(0, 5);
  row.recentNewsCount = recentNews.length;
  row.newsStatus = 'OK';
  row.newsSource = source;
  if (recentNews.length) {
    row.score = clamp(row.score + Math.min(15, 8 + recentNews.length * 2), 0, 100);
    row.reasons.push(`최근 뉴스 ${recentNews.length}건`);
  }
  row.spikes = row.spikes.map((s) => {
    const matches = news
      .filter((n) => n.publishedAt)
      .map((n) => ({ n, lead: dayDiff(n.publishedAt as string, s.date) }))
      .filter((x) => x.lead >= 0 && x.lead <= newsLeadDays)
      .sort((a, b) => b.lead - a.lead);
    if (!news.length) return { ...s, preNews: 'UNKNOWN' as const };
    if (!matches.length) return { ...s, preNews: 'NO' as const, leadDays: null, headline: null };
    return { ...s, preNews: 'YES' as const, leadDays: matches[0].lead, headline: matches[0].n.title };
  });
  return row;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (v: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const started = Date.now();
  const body = await req.json().catch(() => ({}));
  const stocks = (Array.isArray(body?.stocks) ? body.stocks : []).slice(0, 50) as StockInput[];
  const lookbackDays = clamp(Number(body?.lookbackDays) || 60, 20, 240);
  const spikePct = clamp(Number(body?.spikePct) || 5, 2, 20);
  const newsLeadDays = clamp(Number(body?.newsLeadDays) || 3, 1, 10);
  if (!stocks.length) return NextResponse.json({ error: '분석할 종목이 없습니다.' }, { status: 400 });

  const rows = await mapLimit(stocks, 8, async (stock) => {
    try {
      const bars = await fetchYahooBars(stock.code, 'KOSPI', Math.max(90, lookbackDays + 30));
      return analyzeBars(stock, bars, lookbackDays, spikePct);
    } catch (e) {
      return {
        ...stock,
        ok: false,
        error: e instanceof Error ? e.message : 'Yahoo Finance 수집 실패',
        spikeCount: 0,
        spikes: [],
        baseScore: 0,
        score: 0,
        reasons: [],
        newsStatus: 'SKIPPED',
        recentNewsCount: 0,
        latestNews: [],
      } as RowResult;
    }
  });

  const newsTargets = rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => row.ok && (row.spikeCount > 0 || row.baseScore >= 38))
    .sort((a, b) => (Number(b.row.spikeCount > 0) - Number(a.row.spikeCount > 0)) || b.row.baseScore - a.row.baseScore)
    .slice(0, 20);

  await mapLimit(newsTargets, 4, async ({ row }) => {
    try {
      const got = await fetchNews(row.name, row.code);
      attachNews(row, got.items, newsLeadDays, got.source);
    } catch {
      row.newsStatus = 'ERROR';
    }
    return row;
  });

  const failures = rows.filter((r) => !r.ok).map((r) => ({ code: r.code, name: r.name, error: r.error }));
  return NextResponse.json({
    ok: true,
    rows,
    failures,
    meta: {
      requested: stocks.length,
      completed: rows.filter((r) => r.ok).length,
      elapsedMs: Date.now() - started,
      lookbackDays,
      spikePct,
      newsLeadDays,
      newsChecked: newsTargets.length,
    },
  });
}
