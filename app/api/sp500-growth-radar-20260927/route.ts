// @ts-nocheck
import { createHash, timingSafeEqual } from 'crypto';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const ACCESS_HASH = 'dcf62aebf5b5020c642a92711ca9b135eaaa5524dd31bd43a15d3abb68d46619';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36';
let sessionCache = { cookie: '', crumb: '', expiresAt: 0 };
let universeCache = { rows: [], source: '', expiresAt: 0 };

type YahooSession = { cookie: string; crumb: string; expiresAt: number };

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
  if (!force && sessionCache.crumb && Date.now() < sessionCache.expiresAt) return sessionCache;
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
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain,*/*', ...(cookie ? { Cookie: cookie } : {}) },
    cache: 'no-store'
  });
  cookie = mergeCookies(cookie, parseCookieHeader(crumbRes.headers.get('set-cookie')));
  const crumb = (await crumbRes.text()).trim();
  if (!crumbRes.ok || !crumb || /unauthorized|too many requests/i.test(crumb)) {
    throw new Error(`Yahoo session failed (${crumbRes.status})`);
  }
  sessionCache = { cookie, crumb, expiresAt: Date.now() + 20 * 60 * 1000 };
  return sessionCache;
}

async function yahooFetch(url: string, options: RequestInit = {}, retry = true): Promise<Response> {
  const sess = await getYahooSession(false);
  const headers = new Headers(options.headers || {});
  headers.set('User-Agent', USER_AGENT);
  headers.set('Accept', 'application/json,text/plain,*/*');
  if (sess.cookie) headers.set('Cookie', sess.cookie);
  const join = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${join}crumb=${encodeURIComponent(sess.crumb)}`, {
    ...options, headers, cache: 'no-store'
  });
  if ((res.status === 401 || res.status === 403) && retry) {
    await getYahooSession(true);
    return yahooFetch(url, options, false);
  }
  return res;
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
  const currentPrice = raw(f.currentPrice) ?? raw(p.regularMarketPrice);
  const targetMeanPrice = raw(f.targetMeanPrice);
  const earningsDate = c?.earnings?.earningsDate?.[0];
  return {
    symbol,
    name: p.longName || p.shortName || symbol,
    exchange: p.exchangeName || p.exchange || '',
    marketCapB: typeof raw(p.marketCap) === 'number' ? raw(p.marketCap) / 1e9 : null,
    epsGrowthPct: pct(f.earningsGrowth),
    revenueGrowthPct: pct(f.revenueGrowth),
    currentPrice,
    targetMeanPrice,
    upsidePct: currentPrice && targetMeanPrice ? (targetMeanPrice / currentPrice - 1) * 100 : null,
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

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else {
      if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter(r => r.some(Boolean)).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
function normalizeSymbol(s: string) { return String(s || '').trim().replace('.', '-'); }
function stripHtml(s: string) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').trim();
}

async function fetchUniverse() {
  if (universeCache.rows.length > 450 && Date.now() < universeCache.expiresAt) return universeCache;
  try {
    const url = 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv';
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, cache: 'no-store' });
    if (!res.ok) throw new Error(`GitHub constituents ${res.status}`);
    const rows = parseCsv(await res.text()).map((x: any) => ({
      symbol: normalizeSymbol(x.Symbol),
      name: x.Security || x.Name || x.Symbol,
      sector: x['GICS Sector'] || x.Sector || '',
      industry: x['GICS Sub-Industry'] || '',
      source: 'S&P500 constituents / Yahoo Finance'
    })).filter((x: any) => x.symbol);
    if (rows.length < 450) throw new Error(`Too few constituents (${rows.length})`);
    universeCache = { rows, source: 'Current S&P500 constituents (open dataset)', expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
    return universeCache;
  } catch (firstError: any) {
    const res = await fetch('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', { headers: { 'User-Agent': USER_AGENT }, cache: 'no-store' });
    if (!res.ok) throw new Error(`S&P500 universe failed: ${firstError?.message}; Wikipedia ${res.status}`);
    const html = await res.text();
    const table = html.match(/<table[^>]*id="constituents"[\s\S]*?<\/table>/i)?.[0];
    if (!table) throw new Error('S&P500 constituents table not found');
    const rows: any[] = [];
    for (const m of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(x => stripHtml(x[1]));
      if (cells.length >= 4) rows.push({ symbol: normalizeSymbol(cells[0]), name: cells[1], sector: cells[2], industry: cells[3], source: 'Wikipedia S&P500 / Yahoo Finance' });
    }
    if (rows.length < 450) throw new Error(`Too few Wikipedia constituents (${rows.length})`);
    universeCache = { rows, source: 'Wikipedia current S&P500 constituents', expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
    return universeCache;
  }
}

export async function GET(req: Request) {
  if (!authOk(req)) return json({ ok: false, error: '인증번호가 올바르지 않습니다.' }, 401);
  const action = new URL(req.url).searchParams.get('action') || 'auth';
  if (action === 'auth') return json({ ok: true, permanent: true });
  if (action === 'universe') {
    try {
      const u = await fetchUniverse();
      return json({ ok: true, source: u.source, rows: u.rows });
    } catch (e: any) {
      return json({ ok: false, error: e?.message || String(e) }, 502);
    }
  }
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
    try { return { ok: true, symbol, data: await fetchQuoteSummary(symbol) }; }
    catch (e: any) { return { ok: false, symbol, error: e?.message || String(e) }; }
  }));
  return json({ ok: true, rows });
}
