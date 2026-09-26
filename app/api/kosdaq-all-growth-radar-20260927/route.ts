// @ts-nocheck
import { createHash, timingSafeEqual } from 'crypto';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const ACCESS_HASH = 'c34db5fb0b0ded382c00847bfe4908f874a5e87c9cc9752d919a2cc1965ecae1';
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';

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
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/\u00a0/g, ' ').replace(/,/g, '').replace(/[원%배주\s]/g, '').trim();
  if (!s || s === '-' || s === '--' || s === 'N/A') return null;
  const x = Number(s.replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(x) ? x : null;
}
function marketCapEok(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/,/g, '').replace(/\s+/g, '');
  if (!s) return null;
  let total = 0, found = false;
  const jo = s.match(/([0-9.]+)조/); if (jo) { total += Number(jo[1]) * 10000; found = true; }
  const eok = s.match(/([0-9.]+)억/); if (eok) { total += Number(eok[1]); found = true; }
  if (found) return Number.isFinite(total) ? total : null;
  return num(s.replace(/억원/g, ''));
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function fetchWithTimeout(url: string, timeout = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    return await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.6', Referer: 'https://m.stock.naver.com/' }, cache: 'no-store' });
  } finally { clearTimeout(t); }
}
async function fetchJson(url: string) {
  let last = '';
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetchWithTimeout(url);
      if (!r.ok) { last = `HTTP ${r.status}`; await sleep(200 * (i + 1)); continue; }
      const text = await r.text();
      if (!text.trim().startsWith('{') && !text.trim().startsWith('[')) { last = 'JSON 아닌 응답'; await sleep(200 * (i + 1)); continue; }
      return JSON.parse(text);
    } catch (e: any) { last = e?.message || String(e); await sleep(200 * (i + 1)); }
  }
  throw new Error(last || '네이버 JSON 수집 실패');
}
function pickArray(j: any): any[] {
  if (Array.isArray(j)) return j;
  for (const k of ['stocks', 'items', 'data', 'stockList', 'result']) if (Array.isArray(j?.[k])) return j[k];
  if (Array.isArray(j?.result?.stocks)) return j.result.stocks;
  if (Array.isArray(j?.result?.items)) return j.result.items;
  return [];
}
function normalizeUniverse(x: any, rank: number) {
  const code = String(x?.itemCode ?? x?.itemcode ?? x?.stockCode ?? x?.code ?? '').match(/\d{6}/)?.[0] || '';
  const name = String(x?.stockName ?? x?.name ?? x?.itemName ?? '').trim();
  if (!code || !name) return null;
  return {
    rank, code, name, market: 'KOSDAQ',
    currentPrice: num(x?.closePrice ?? x?.currentPrice ?? x?.nowVal ?? x?.price),
    changePct: num(x?.fluctuationsRatio ?? x?.changeRate ?? x?.changePct ?? x?.rate),
    marketCapEok: marketCapEok(x?.marketValue ?? x?.marketCap ?? x?.marketValueAmount),
    source: 'Naver Mobile marketValue API'
  };
}
async function fetchUniverseAll() {
  const out: any[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 30; page++) {
    const j = await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/KOSDAQ?page=${page}&pageSize=100`);
    const rows = pickArray(j);
    if (!rows.length) break;
    let added = 0;
    for (const x of rows) {
      const row = normalizeUniverse(x, out.length + 1);
      if (row && !seen.has(row.code)) { seen.add(row.code); out.push(row); added++; }
    }
    if (!added || rows.length < 100) break;
  }
  if (out.length < 1000) throw new Error(`KOSDAQ 목록이 ${out.length}개뿐입니다.`);
  return out.map((x, i) => ({ ...x, rank: i + 1 }));
}
function infoMap(integration: any) {
  const m: Record<string, any> = {};
  for (const x of integration?.totalInfos || []) {
    const k = x?.code || x?.key;
    if (k) m[k] = x?.value ?? x?.valueRaw ?? null;
  }
  return m;
}
function normLabel(s: unknown) { return String(s ?? '').replace(/\s+/g, '').replace(/\([^)]*\)/g, '').toUpperCase(); }
function parseFinance(j: any) {
  const f = j?.financeInfo || j || {};
  const titles = Array.isArray(f?.trTitleList) ? f.trTitleList : [];
  const rowList = Array.isArray(f?.rowList) ? f.rowList : [];
  const rows: Record<string, any> = {};
  for (const r of rowList) rows[normLabel(r?.title)] = r;
  return { titles, rows };
}
function rowValues(fin: any, matcher: (label: string) => boolean) {
  const entry = Object.entries(fin.rows).find(([label]) => matcher(label))?.[1] as any;
  if (!entry) return fin.titles.map(() => null);
  return fin.titles.map((t: any) => num(entry?.columns?.[t?.key]?.value ?? entry?.columns?.[t?.key] ?? null));
}
function growth(cur: number | null, prev: number | null) {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}
function latestTwoActual(fin: any, values: (number | null)[]) {
  const idx: number[] = [];
  for (let i = fin.titles.length - 1; i >= 0; i--) {
    const t = fin.titles[i] || {};
    const consensus = String(t.isConsensus ?? 'N').toUpperCase() === 'Y';
    if (!consensus && values[i] != null) idx.push(i);
    if (idx.length === 2) break;
  }
  return idx;
}
function industryName(integration: any) {
  const v = integration?.industryCompareInfo;
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = x?.industryName || x?.name || x?.industry || x?.industryNameKor;
      if (s) return String(s);
    }
  } else if (v && typeof v === 'object') {
    const s = v.industryName || v.name || v.industry || v.industryNameKor;
    if (s) return String(s);
  }
  return integration?.industryName || integration?.sectorName || null;
}
async function fetchNaverDetail(code: string) {
  const [integration, quarter] = await Promise.all([
    fetchJson(`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/integration`),
    fetchJson(`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/finance/quarter`)
  ]);
  const im = infoMap(integration);
  const fin = parseFinance(quarter);
  const revenue = rowValues(fin, label => label === '매출액' || label.startsWith('매출액'));
  const epsQ = rowValues(fin, label => label === 'EPS' || label.startsWith('EPS'));
  const revIdx = latestTwoActual(fin, revenue);
  const epsIdx = latestTwoActual(fin, epsQ);
  const latestIdx = Math.max(revIdx[0] ?? -1, epsIdx[0] ?? -1);
  let currentPrice = num(integration?.dealTrendInfos?.[0]?.closePrice) ?? num(im.lastClosePrice);
  let stockName = integration?.stockName || code;
  if (currentPrice == null) {
    try {
      const basic = await fetchJson(`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/basic`);
      currentPrice = num(basic?.closePrice);
      stockName = basic?.stockName || stockName;
    } catch {}
  }
  const targetMeanPrice = num(integration?.consensusInfo?.priceTargetMean);
  return {
    code, name: stockName, market: 'KOSDAQ', currentPrice,
    marketCapEok: marketCapEok(im.marketValue), targetMeanPrice,
    upsidePct: currentPrice && targetMeanPrice ? (targetMeanPrice / currentPrice - 1) * 100 : null,
    epsGrowthPct: epsIdx.length >= 2 ? growth(epsQ[epsIdx[0]], epsQ[epsIdx[1]]) : null,
    revenueGrowthPct: revIdx.length >= 2 ? growth(revenue[revIdx[0]], revenue[revIdx[1]]) : null,
    trailingEps: num(im.eps), forwardEps: num(im.cnsEps), trailingPE: num(im.per), forwardPE: num(im.cnsPer),
    latestQuarter: latestIdx >= 0 ? (fin.titles[latestIdx]?.title || fin.titles[latestIdx]?.key || null) : null,
    sector: industryName(integration), source: 'Naver Mobile JSON'
  };
}
async function health() {
  try {
    const j = await fetchJson('https://m.stock.naver.com/api/stocks/marketValue/KOSDAQ?page=1&pageSize=20');
    const u = pickArray(j);
    const sampleCode = String(u?.[0]?.itemCode ?? u?.[0]?.stockCode ?? u?.[0]?.code ?? '247540').match(/\d{6}/)?.[0] || '247540';
    const d = await fetchNaverDetail(sampleCode);
    return json({ ok: true, universeRows: u.length, sampleCode, detail: { parsed: true, hasPrice: d.currentPrice != null, hasRevenueGrowth: d.revenueGrowthPct != null, hasEpsGrowth: d.epsGrowthPct != null, hasTrailingEps: d.trailingEps != null, hasForwardEps: d.forwardEps != null, hasTarget: d.targetMeanPrice != null, latestQuarter: d.latestQuarter, source: d.source } });
  } catch (e: any) { return json({ ok: false, error: e?.message || String(e) }, 502); }
}
export async function GET(req: Request) {
  const u = new URL(req.url);
  const action = u.searchParams.get('action') || 'auth';
  if (action === 'health') return health();
  if (!authOk(req)) return json({ ok: false, error: '인증번호가 올바르지 않습니다.' }, 401);
  if (action === 'auth') return json({ ok: true, permanent: true });
  if (action === 'universe') {
    try {
      const all = await fetchUniverseAll();
      const limit = Math.max(0, Number(u.searchParams.get('limit') || 0));
      const rows = limit ? all.slice(0, limit) : all;
      return json({ ok: true, source: 'Naver Mobile marketValue API', total: all.length, rows });
    } catch (e: any) { return json({ ok: false, error: e?.message || String(e) }, 502); }
  }
  return json({ ok: false, error: 'Unknown action' }, 400);
}
export async function POST(req: Request) {
  if (!authOk(req)) return json({ ok: false, error: '인증번호가 올바르지 않습니다.' }, 401);
  const action = new URL(req.url).searchParams.get('action') || '';
  if (action !== 'details') return json({ ok: false, error: 'Unknown action' }, 400);
  const body = await req.json().catch(() => ({})) as any;
  const codes = Array.isArray(body.codes) ? body.codes.map((x: any) => String(x).match(/\d{6}/)?.[0]).filter(Boolean).slice(0, 20) : [];
  if (!codes.length) return json({ ok: false, error: 'codes required' }, 400);
  const rows = await Promise.all(codes.map(async (code: string) => {
    try { return { ok: true, code, data: await fetchNaverDetail(code) }; }
    catch (e: any) { return { ok: false, code, error: e?.message || String(e) }; }
  }));
  return json({ ok: true, rows });
}
