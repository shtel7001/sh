import { createHash, timingSafeEqual } from 'crypto';
import fallbackSymbols from './fallback';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const ACCESS_HASH = 'c34db5fb0b0ded382c00847bfe4908f874a5e87c9cc9752d919a2cc1965ecae1';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
let sessionCache = { cookie: '', crumb: '', expiresAt: 0 };

type YahooSession = { cookie: string; crumb: string; expiresAt: number };

type TopRow = {
  rank: number;
  symbol: string;
  name: string;
  exchange: string;
  marketCapB: number | null;
  source: string;
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function verifyCode(code: string | null) {
  if (!code) return false;
  const digest = createHash('sha256').update(code.trim()).digest();
  const expected = Buffer.from(ACCESS_HASH, 'hex');
  return digest.length === expected.length && timingSafeEqual(digest, expected);
}

function authOk(req: Request) {
  return verifyCode(req.headers.get('x-access-code') || req.headers.get('x-radar-key'));
}

function parseCookieHeader(raw: string | null) {
  if (!raw) return '';
  const found: string[] = [];
  for (const name of ['A1', 'A3', 'A1S', 'GUC', 'GUCS']) {
    const m = raw.match(new RegExp(`(?:^|[,;]\\s*)${name}=([^;,]+)`));
    if (m) found.push(`${name}=${m[1]}`);
  }
  return found.join('; ');
}

function mergeCookies(...parts: string[]) {
  const map = new Map<string, string>();
  for (const part of parts) {
    for (const item of (part || '').split(/;\s*/).filter(Boolean)) {
      const i = item.indexOf('=');
      if (i > 0) map.set(item.slice(0, i), item.slice(i + 1));
    }
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function getYahooSession(force = false): Promise<YahooSession> {
  if (!force && sessionCache.crumb && sessionCache.cookie && Date.now() < sessionCache.expiresAt) return sessionCache;

  let cookie = '';
  try {
    const boot = await fetch('https://fc.yahoo.com/', {
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      redirect: 'manual',
      cache: 'no-store'
    });
    cookie = mergeCookies(cookie, parseCookieHeader(boot.headers.get('set-cookie')));
  } catch {}

  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/plain,*/*',
      ...(cookie ? { Cookie: cookie } : {})
    },
    cache: 'no-store'
  });
  cookie = mergeCookies(cookie, parseCookieHeader(crumbRes.headers.get('set-cookie')));
  const crumb = (await crumbRes.text()).trim();
  if (!crumbRes.ok || !crumb || /unauthorized|too many requests/i.test(crumb)) throw new Error(`Yahoo session failed (${crumbRes.status})`);

  sessionCache = { cookie, crumb, expiresAt: Date.now() + 20 * 60 * 1000 };
  return sessionCache;
}

async function yahooFetch(url: string, options: RequestInit = {}, retry = true) {
  const sess = await getYahooSession(false);
  const headers = new Headers(options.headers || {});
  headers.set('User-Agent', USER_AGENT);
  headers.set('Accept', 'application/json,text/plain,*/*');
  if (sess.cookie) headers.set('Cookie', sess.cookie);
  const join = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${join}crumb=${encodeURIComponent(sess.crumb)}`, { ...options, headers, cache: 'no-store' });
  if ((res.status === 401 || res.status === 403) && retry) {
    await getYahooSession(true);
    return yahooFetch(url, options, false);
  }
  return res;
}

async function fetchScreenerPage(offset: number, size: number) {
  const payload = {
    offset,
    size,
    sortField: 'intradaymarketcap',
    sortType: 'DESC',
    quoteType: 'EQUITY',
    query: {
      operator: 'AND',
      operands: [
        { operator: 'EQ', operands: ['region', 'us'] },
        { operator: 'EQ', operands: ['exchange', 'NMS'] }
      ]
    },
    userId: '',
    userIdType: 'guid'
  };
  const url = 'https://query1.finance.yahoo.com/v1/finance/screener?formatted=false&lang=en-US&region=US&corsDomain=finance.yahoo.com';
  const res = await yahooFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Yahoo Screener ${res.status}`);
  const body = await res.json() as any;
  const quotes = body?.finance?.result?.[0]?.quotes;
  if (!Array.isArray(quotes)) throw new Error('Yahoo Screener response format changed');
  return quotes as any[];
}

function raw(v: any): any {
  if (v == null) return null;
  if (typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'raw')) return v.raw;
  return v;
}
function pct(v: any) {
  const n = raw(v);
  return typeof n === 'number' && Number.isFinite(n) ? n * 100 : null;
}
function isoDateFromUnix(v: any) {
  const n = raw(v);
  if (!n || !Number.isFinite(Number(n))) return null;
  return new Date(Number(n) * 1000).toISOString().slice(0, 10);
}

async function fetchQuoteSummary(symbol: string) {
  const modules = ['price','financialData','defaultKeyStatistics','summaryDetail','assetProfile','calendarEvents'].join(',');
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?formatted=false&lang=en-US&region=US&modules=${encodeURIComponent(modules)}&corsDomain=finance.yahoo.com`;
  const res = await yahooFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json() as any;
  const root = body?.quoteSummary?.result?.[0];
  if (!root) throw new Error(body?.quoteSummary?.error?.description || 'No Yahoo data');
  const p = root.price || {}, f = root.financialData || {}, k = root.defaultKeyStatistics || {}, s = root.summaryDetail || {}, a = root.assetProfile || {}, c = root.calendarEvents || {};
  const earningsDate = c?.earnings?.earningsDate?.[0];
  return {
    symbol,
    name: p.longName || p.shortName || symbol,
    exchange: p.exchangeName || p.exchange || 'NMS',
    marketCapB: typeof raw(p.marketCap) === 'number' ? raw(p.marketCap) / 1e9 : null,
    epsGrowthPct: pct(f.earningsGrowth),
    revenueGrowthPct: pct(f.revenueGrowth),
    currentPrice: raw(f.currentPrice) ?? raw(p.regularMarketPrice),
    targetMeanPrice: raw(f.targetMeanPrice),
    trailingEps: raw(k.trailingEps) ?? raw(p.epsTrailingTwelveMonths),
    forwardEps: raw(k.forwardEps) ?? raw(p.epsForward),
    trailingPE: raw(s.trailingPE) ?? raw(p.trailingPE),
    forwardPE: raw(s.forwardPE) ?? raw(p.forwardPE),
    sector: a.sector || null,
    industry: a.industry || null,
    earningsDate: isoDateFromUnix(earningsDate),
    source: 'Yahoo Finance'
  };
}

async function handleTop(req: Request) {
  const u = new URL(req.url);
  const requested = Math.max(10, Math.min(300, Number(u.searchParams.get('count') || 300)));
  try {
    const pages: any[] = [];
    let remaining = requested, offset = 0;
    while (remaining > 0) {
      const size = Math.min(250, remaining);
      const quotes = await fetchScreenerPage(offset, size);
      pages.push(...quotes);
      if (quotes.length < size) break;
      remaining -= quotes.length;
      offset += quotes.length;
    }
    const rows: TopRow[] = pages.slice(0, requested).map((q, i) => ({
      rank: i + 1,
      symbol: q.symbol,
      name: q.longName || q.shortName || q.displayName || q.symbol,
      exchange: q.exchange || 'NMS',
      marketCapB: typeof q.marketCap === 'number' ? q.marketCap / 1e9 : null,
      source: 'Yahoo Screener'
    }));
    if (rows.length < Math.min(50, requested)) throw new Error('Yahoo returned too few rows');
    return json({ ok: true, source: 'Yahoo Screener live', fallback: false, rows });
  } catch (error: any) {
    return json({
      ok: true,
      source: 'Uploaded 2026-09-10 Yahoo snapshot fallback',
      fallback: true,
      warning: `Yahoo Screener live call failed: ${error?.message || String(error)}`,
      rows: fallbackSymbols.slice(0, requested).map((symbol, i) => ({ rank: i + 1, symbol, name: symbol, exchange: 'NMS', marketCapB: null, source: 'Uploaded 2026-09-10 Yahoo snapshot fallback' }))
    });
  }
}

export async function GET(req: Request) {
  if (!authOk(req)) return json({ ok: false, error: '인증번호가 올바르지 않습니다.' }, 401);
  const action = new URL(req.url).searchParams.get('action') || 'auth';
  if (action === 'auth') return json({ ok: true, permanent: true });
  if (action === 'top') return handleTop(req);
  return json({ ok: false, error: 'Unknown action' }, 400);
}

export async function POST(req: Request) {
  if (!authOk(req)) return json({ ok: false, error: '인증번호가 올바르지 않습니다.' }, 401);
  const action = new URL(req.url).searchParams.get('action') || '';
  if (action !== 'details') return json({ ok: false, error: 'Unknown action' }, 400);
  const body = await req.json().catch(() => ({})) as any;
  const symbols = Array.isArray(body.symbols) ? body.symbols.map(String).slice(0, 20) : [];
  if (!symbols.length) return json({ ok: false, error: 'symbols required' }, 400);
  const rows = await Promise.all(symbols.map(async (symbol) => {
    try {
      return { ok: true, symbol, data: await fetchQuoteSummary(symbol) };
    } catch (e: any) {
      return { ok: false, symbol, error: e?.message || String(e) };
    }
  }));
  return json({ ok: true, rows });
}
