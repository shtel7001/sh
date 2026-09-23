import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const med = (a) => {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  const m = Math.floor(b.length / 2);
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};
const pct = (a, b) => b ? (a / b - 1) * 100 : 0;

async function yahoo(sym, days) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d&includePrePost=false&events=div%2Csplits`, {
    headers: { 'User-Agent': 'Mozilla/5.0 low-point-cycle-radar/1.0' },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  const j = await r.json();
  const x = j?.chart?.result?.[0];
  if (!x) throw new Error('Yahoo no data');
  const q = x.indicators?.quote?.[0] || {};
  const c = x.indicators?.adjclose?.[0]?.adjclose || q.close || [];
  const o = [];
  (x.timestamp || []).forEach((t, i) => {
    const v = Number(c[i]);
    if (Number.isFinite(v) && v > 0) o.push({ date: new Date(t * 1000).toISOString().slice(0, 10), close: v });
  });
  if (o.length < Math.min(days, 12)) throw new Error('Yahoo short');
  return o.slice(-days);
}

async function daum(code, days) {
  const symbol = `A${code}`;
  const limit = Math.min(260, Math.max(days + 10, 30));
  const u = new URL(`https://finance.daum.net/api/charts/${symbol}/days`);
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('adjusted', 'true');
  const r = await fetch(u, {
    headers: {
      'User-Agent': 'Mozilla/5.0 low-point-cycle-radar/1.0',
      Accept: 'application/json, text/plain, */*',
      Referer: `https://finance.daum.net/quotes/${symbol}`,
    },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Daum chart ${r.status}`);
  const j = await r.json();
  const o = (j?.data || []).map((x) => ({
    date: String(x.date || x.candleTime || '').slice(0, 10),
    close: Number(x.tradePrice),
  })).filter((x) => x.date && Number.isFinite(x.close) && x.close > 0);
  o.sort((a, b) => a.date.localeCompare(b.date));
  if (o.length < Math.min(days, 12)) throw new Error('Daum chart short');
  return o.slice(-days);
}

async function history(s, d) {
  try {
    return { rows: await yahoo(s.yahoo, d), source: 'Yahoo' };
  } catch {
    return { rows: await daum(s.code, d), source: 'Daum' };
  }
}

function pivots(rows) {
  const n = rows.length;
  const w = n < 35 ? 1 : n < 90 ? 2 : 3;
  const p = [];
  for (let i = w; i < n - w; i++) {
    const c = rows[i].close;
    const ns = [];
    for (let j = i - w; j <= i + w; j++) if (j !== i) ns.push(rows[j].close);
    if (ns.every((x) => c <= x) && ns.some((x) => c < x)) p.push({ type: 'low', idx: i, price: c });
    if (ns.every((x) => c >= x) && ns.some((x) => c > x)) p.push({ type: 'high', idx: i, price: c });
  }
  const z = [];
  for (const a of p) {
    const l = z.at(-1);
    if (!l || l.type !== a.type) z.push(a);
    else if ((a.type === 'low' && a.price < l.price) || (a.type === 'high' && a.price > l.price)) z[z.length - 1] = a;
  }
  return z;
}

function analyze(s, rows, proximity) {
  if (rows.length < 12) return null;
  const p = pivots(rows);
  const lo = p.filter((x) => x.type === 'low');
  const hi = p.filter((x) => x.type === 'high');
  if (lo.length < 2 || hi.length < 2) return null;
  const L = lo.slice(-5), H = hi.slice(-5);
  const support = med(L.map((x) => x.price));
  const resistance = med(H.map((x) => x.price));
  if (!(support > 0 && resistance > support)) return null;
  const disp = (a, c) => med(a.map((v) => Math.abs(v - c) / c * 100));
  const lowDisp = disp(L.map((x) => x.price), support);
  const highDisp = disp(H.map((x) => x.price), resistance);
  const amplitude = pct(resistance, support);
  const current = rows.at(-1).close;
  const distance = pct(current, support);
  const rangePos = (current - support) / (resistance - support);
  const alt = Math.max(0, p.length - 1);
  const r5 = rows.length > 6 ? pct(current, rows.at(-6).close) : 0;
  const gaps = [];
  for (let i = 1; i < lo.length; i++) gaps.push(lo[i].idx - lo[i - 1].idx);
  const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const gdisp = avg ? med(gaps.map((g) => Math.abs(g - avg) / avg * 100)) : 50;
  const prox = clamp(100 - Math.max(distance, 0) / Math.max(proximity, .5) * 100, 0, 100);
  const rep = clamp(100 - lowDisp * 7 - highDisp * 3, 0, 100);
  const cyc = clamp(25 + alt * 8 - gdisp * .45, 0, 100);
  const amp = clamp((amplitude - 5) * 4.2, 0, 100);
  const score = clamp(Math.round(prox * .4 + rep * .28 + cyc * .17 + amp * .15 + (r5 < 0 ? 8 : 0)), 0, 100);
  if (!(distance >= -5 && distance <= proximity && rangePos <= .38 && amplitude >= 7 && lowDisp <= 12 && highDisp <= 20 && alt >= 4)) return null;
  return {
    ...s,
    current,
    support,
    resistance,
    distance,
    rangePos: rangePos * 100,
    amplitude,
    lowDisp,
    highDisp,
    cycles: Math.floor(alt / 2),
    pivotLows: lo.length,
    pivotHighs: hi.length,
    score,
    ret5: r5,
    reason: `반복저점 ${lo.length}회 · 반복고점 ${hi.length}회 · 지지선 대비 ${distance >= 0 ? '+' : ''}${distance.toFixed(1)}% · 저점 편차 ${lowDisp.toFixed(1)}% · 고저 변동폭 ${amplitude.toFixed(1)}%${r5 < 0 ? ' · 최근 5일 저점 방향 접근' : ''}`,
    spark: rows.slice(-60).map((r) => [r.date, r.close]),
  };
}

async function one(s, d, p) {
  try {
    const h = await history(s, d);
    const hit = analyze(s, h.rows, p);
    return { ok: true, source: h.source, hit: hit ? { ...hit, source: h.source } : null };
  } catch (e) {
    return { ok: false, code: s.code, name: s.name, error: String(e?.message || e) };
  }
}

export async function POST(req) {
  try {
    const b = await req.json();
    const days = Math.min(240, Math.max(1, Number(b.days || 240)));
    const proximity = Math.min(20, Math.max(1, Number(b.proximity || 7)));
    const stocks = Array.isArray(b.stocks) ? b.stocks.slice(0, 25) : [];
    const z = await Promise.all(stocks.map((s) => one(s, days, proximity)));
    return NextResponse.json({
      ok: true,
      scanned: stocks.length,
      hits: z.filter((x) => x.ok && x.hit).map((x) => x.hit),
      errors: z.filter((x) => !x.ok),
      sources: z.filter((x) => x.ok).reduce((a, x) => { a[x.source] = (a[x.source] || 0) + 1; return a; }, {}),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
