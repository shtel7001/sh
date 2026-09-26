// @ts-nocheck
import { createHash, timingSafeEqual } from 'crypto';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const ACCESS_HASH = 'c34db5fb0b0ded382c00847bfe4908f874a5e87c9cc9752d919a2cc1965ecae1';
const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';

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

function n(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/\u00a0/g, ' ').replace(/,/g, '').replace(/[원%배억원주\s]/g, '').trim();
  if (!s || s === '-' || s === '--' || s === 'N/A') return null;
  const x = Number(s.replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(x) ? x : null;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeout = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try { return await fetch(url, { ...init, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

async function fetchJson(url: string) {
  let last = '';
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetchWithTimeout(url, { headers: { 'User-Agent': UA_MOBILE, Accept: 'application/json,text/plain,*/*', 'Accept-Language': 'ko-KR,ko;q=0.9', Referer: 'https://m.stock.naver.com/' }, cache: 'no-store' }, 9000);
      if (!r.ok) { last = `HTTP ${r.status}`; await sleep(200 * (i + 1)); continue; }
      const text = await r.text();
      if (!text.trim().startsWith('{') && !text.trim().startsWith('[')) { last = 'JSON 아닌 응답'; await sleep(200 * (i + 1)); continue; }
      return JSON.parse(text);
    } catch (e: any) { last = e?.message || String(e); await sleep(200 * (i + 1)); }
  }
  throw new Error(last || '네이버 JSON 수집 실패');
}

async function fetchHtml(url: string) {
  let last = '';
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetchWithTimeout(url, { headers: { 'User-Agent': UA_PC, Accept: 'text/html,application/xhtml+xml,*/*', 'Accept-Language': 'ko-KR,ko;q=0.9', Referer: 'https://finance.naver.com/' }, cache: 'no-store' }, 10000);
      if (!r.ok) { last = `HTTP ${r.status}`; await sleep(250 * (i + 1)); continue; }
      const b = Buffer.from(await r.arrayBuffer());
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      return ct.includes('utf-8') ? b.toString('utf8') : iconv.decode(b, 'EUC-KR');
    } catch (e: any) { last = e?.message || String(e); await sleep(250 * (i + 1)); }
  }
  throw new Error(last || '네이버 HTML 수집 실패');
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
    rank,
    code,
    name,
    market: 'KOSPI',
    currentPrice: n(x?.closePrice ?? x?.currentPrice ?? x?.nowVal ?? x?.price),
    changePct: n(x?.fluctuationsRatio ?? x?.changeRate ?? x?.changePct ?? x?.rate),
    marketCapEok: n(x?.marketValue ?? x?.marketCap ?? x?.marketValueAmount),
    source: 'Naver Mobile marketValue'
  };
}

async function fetchUniverseMobile() {
  const out: any[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 20; page++) {
    const j = await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=${page}&pageSize=100`);
    const rows = pickArray(j);
    if (!rows.length) break;
    let added = 0;
    for (const x of rows) {
      const row = normalizeUniverse(x, out.length + 1);
      if (row && !seen.has(row.code)) { seen.add(row.code); out.push(row); added++; }
    }
    if (!added || rows.length < 100) break;
  }
  if (out.length < 500) throw new Error(`모바일 KOSPI 목록이 ${out.length}개뿐입니다.`);
  return out.map((x, i) => ({ ...x, rank: i + 1 }));
}

async function fetchUniversePc() {
  const out: any[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 30; page++) {
    const html = await fetchHtml(`https://finance.naver.com/sise/sise_market_sum.naver?sosok=0&page=${page}`);
    const $ = cheerio.load(html);
    let added = 0;
    $('table.type_2 tr, table.type2 tr').each((_, tr) => {
      const a = $(tr).find('a.tltle, a[href*="/item/main.naver?code="]').first();
      const name = a.text().trim();
      const code = (a.attr('href') || '').match(/code=(\d{6})/)?.[1] || '';
      if (!code || !name || seen.has(code)) return;
      const cells = $(tr).find('td').map((__, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
      seen.add(code);
      out.push({ rank: out.length + 1, code, name, market: 'KOSPI', currentPrice: n(cells[2] || ''), changePct: n(cells[4] || ''), marketCapEok: n(cells[6] || ''), source: 'Naver Finance PC market sum' });
      added++;
    });
    if (!added) break;
    if (added < 40) break;
  }
  if (out.length < 500) throw new Error(`PC KOSPI 목록이 ${out.length}개뿐입니다.`);
  return out.map((x, i) => ({ ...x, rank: i + 1 }));
}

async function fetchUniverseAll() {
  try { return { rows: await fetchUniverseMobile(), source: 'Naver Mobile marketValue API' }; }
  catch (e1: any) {
    try { return { rows: await fetchUniversePc(), source: 'Naver Finance PC market sum', warning: `모바일 목록 실패: ${e1?.message || e1}` }; }
    catch (e2: any) { throw new Error(`KOSPI 전종목 수집 실패 · mobile: ${e1?.message || e1} / pc: ${e2?.message || e2}`); }
  }
}

function rowLabel(s: string) {
  return s.replace(/\s+/g, '').replace(/\([^)]*IFRS[^)]*\)/gi, '').trim();
}

function growth(cur: number | null, prev: number | null) {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function lastFiniteIndex(a: (number | null)[], test?: (i: number) => boolean) {
  for (let i = a.length - 1; i >= 0; i--) if (a[i] != null && (!test || test(i))) return i;
  return -1;
}

function firstFiniteIndex(a: (number | null)[], test?: (i: number) => boolean) {
  for (let i = 0; i < a.length; i++) if (a[i] != null && (!test || test(i))) return i;
  return -1;
}

async function fetchNaverDetail(code: string) {
  const html = await fetchHtml(`https://finance.naver.com/item/main.naver?code=${encodeURIComponent(code)}`);
  const $ = cheerio.load(html);
  const name = $('.wrap_company h2 a, .wrap_company h2').first().text().replace(/\s+/g, ' ').trim() || code;
  const currentPrice = n($('.no_today .blind').first().text()) ?? n($('p.no_today em span').first().text());
  const flat = $.root().text().replace(/\s+/g, ' ');
  const targetMeanPrice = n(flat.match(/목표주가\s*([0-9,]+)/)?.[1] || '');
  const sector = $('a[href*="sise_group_detail.naver?type=upjong"], a[href*="sise_group_detail.naver?type=upjong"]').first().text().replace(/\s+/g, ' ').trim() || null;

  let fin: any = null;
  $('table').each((_, el) => {
    if (fin) return;
    const txt = $(el).text().replace(/\s+/g, '');
    if (txt.includes('매출액') && txt.includes('EPS(원)') && txt.includes('최근분기실적')) fin = $(el);
  });
  if (!fin) throw new Error('주요재무정보 표를 찾지 못했습니다.');

  let annualCount = 0, quarterCount = 0;
  fin.find('thead tr').first().find('th').each((_, th) => {
    const t = $(th).text().replace(/\s+/g, '');
    const c = Number($(th).attr('colspan') || 0);
    if (t.includes('최근연간실적')) annualCount = c;
    if (t.includes('최근분기실적')) quarterCount = c;
  });

  const dateHeaders = fin.find('thead tr').last().find('th').map((_, th) => $(th).text().replace(/\s+/g, '')).get().filter((x: string) => /\d{4}[./]\d{2}/.test(x));
  if (!annualCount || !quarterCount || annualCount + quarterCount > dateHeaders.length + 1) {
    if (dateHeaders.length >= 8) { annualCount = 4; quarterCount = dateHeaders.length - 4; }
    else { annualCount = Math.max(1, Math.floor(dateHeaders.length / 2)); quarterCount = dateHeaders.length - annualCount; }
  }

  const rows: Record<string, (number | null)[]> = {};
  fin.find('tbody tr').each((_, tr) => {
    const label = rowLabel($(tr).find('th').first().text());
    if (!label) return;
    const vals = $(tr).find('td').map((__, td) => n($(td).text())).get();
    rows[label] = vals;
  });

  const revenue = rows['매출액'] || [];
  const eps = rows['EPS(원)'] || rows['EPS'] || [];
  const per = rows['PER(배)'] || rows['PER'] || [];
  if (!revenue.length && !eps.length) throw new Error('재무 수치 파싱 실패');

  const allLen = Math.max(revenue.length, eps.length, per.length, annualCount + quarterCount);
  const qStart = Math.min(annualCount, allLen);
  const qRevenue = revenue.slice(qStart, qStart + quarterCount);
  const qEps = eps.slice(qStart, qStart + quarterCount);
  const qDates = dateHeaders.slice(annualCount, annualCount + quarterCount);
  const qUsable: number[] = [];
  for (let i = Math.max(qRevenue.length, qEps.length, qDates.length) - 1; i >= 0; i--) {
    if (qRevenue[i] != null || qEps[i] != null) qUsable.push(i);
    if (qUsable.length === 2) break;
  }
  const qi = qUsable[0] ?? -1, qj = qUsable[1] ?? -1;

  const aEps = eps.slice(0, annualCount);
  const aPer = per.slice(0, annualCount);
  const aDates = dateHeaders.slice(0, annualCount);
  let trailingIndex = lastFiniteIndex(aEps, i => !/\(E\)|E$/i.test(aDates[i] || ''));
  if (trailingIndex < 0) trailingIndex = lastFiniteIndex(aEps);
  let forwardIndex = firstFiniteIndex(aEps, i => /\(E\)|E$/i.test(aDates[i] || '') && i > trailingIndex);
  if (forwardIndex < 0) forwardIndex = lastFiniteIndex(aEps);

  let trailingPerIndex = lastFiniteIndex(aPer, i => !/\(E\)|E$/i.test(aDates[i] || ''));
  if (trailingPerIndex < 0) trailingPerIndex = lastFiniteIndex(aPer);
  let forwardPerIndex = firstFiniteIndex(aPer, i => /\(E\)|E$/i.test(aDates[i] || '') && i > trailingPerIndex);
  if (forwardPerIndex < 0) forwardPerIndex = lastFiniteIndex(aPer);

  const latestQuarter = qi >= 0 ? (qDates[qi] || null) : null;
  const epsGrowthPct = qi >= 0 && qj >= 0 ? growth(qEps[qi] ?? null, qEps[qj] ?? null) : null;
  const revenueGrowthPct = qi >= 0 && qj >= 0 ? growth(qRevenue[qi] ?? null, qRevenue[qj] ?? null) : null;

  return {
    code,
    name,
    market: 'KOSPI',
    currentPrice,
    targetMeanPrice,
    upsidePct: currentPrice && targetMeanPrice ? (targetMeanPrice / currentPrice - 1) * 100 : null,
    epsGrowthPct,
    revenueGrowthPct,
    trailingEps: trailingIndex >= 0 ? aEps[trailingIndex] : null,
    forwardEps: forwardIndex >= 0 ? aEps[forwardIndex] : null,
    trailingPE: trailingPerIndex >= 0 ? aPer[trailingPerIndex] : null,
    forwardPE: forwardPerIndex >= 0 ? aPer[forwardPerIndex] : null,
    latestQuarter,
    sector,
    source: 'Naver Finance PC'
  };
}

async function health() {
  try {
    const j = await fetchJson('https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=1&pageSize=20');
    const u = pickArray(j);
    const d = await fetchNaverDetail('005930');
    return json({ ok: true, universeRows: u.length, detail: { parsed: true, hasPrice: d.currentPrice != null, hasRevenueGrowth: d.revenueGrowthPct != null, hasEpsGrowth: d.epsGrowthPct != null, latestQuarter: d.latestQuarter, source: d.source } });
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
      const rows = limit ? all.rows.slice(0, limit) : all.rows;
      return json({ ok: true, source: all.source, warning: all.warning || null, total: all.rows.length, rows });
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
