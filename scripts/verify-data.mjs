const common = {
  'User-Agent': 'Mozilla/5.0 low-point-cycle-radar/1.0',
  Accept: 'application/json, text/plain, */*',
};

async function daumUniverse(market) {
  const u = new URL('https://finance.daum.net/api/trend/market_capitalization');
  u.searchParams.set('page', '1');
  u.searchParams.set('perPage', '100');
  u.searchParams.set('fieldName', 'marketCap');
  u.searchParams.set('order', 'desc');
  u.searchParams.set('market', market);
  u.searchParams.set('pagination', 'true');
  const r = await fetch(u, { headers: { ...common, Referer: 'https://finance.daum.net/domestic/market_cap' } });
  if (!r.ok) throw new Error(`Daum ${market}: HTTP ${r.status}`);
  const j = await r.json();
  const rows = j?.data || [];
  if (!Array.isArray(rows) || rows.length < 90) throw new Error(`Daum ${market}: only ${rows.length} rows`);
  const first = rows[0] || {};
  if (!first.symbolCode || !first.name || !Number(first.marketCap)) throw new Error(`Daum ${market}: unexpected row shape`);
  return `${rows.length} rows`;
}

async function yahoo() {
  const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/005930.KS?range=2y&interval=1d&includePrePost=false&events=div%2Csplits', {
    headers: common,
  });
  if (!r.ok) throw new Error(`Yahoo: HTTP ${r.status}`);
  const j = await r.json();
  const x = j?.chart?.result?.[0];
  const q = x?.indicators?.quote?.[0] || {};
  const adj = x?.indicators?.adjclose?.[0]?.adjclose || q.close || [];
  const valid = adj.filter(v => Number.isFinite(Number(v)) && Number(v) > 0);
  if (valid.length < 240) throw new Error(`Yahoo: only ${valid.length} valid daily bars`);
  return `${valid.length} bars`;
}

async function daumDaily() {
  const r = await fetch('https://finance.daum.net/api/charts/A005930/days?limit=250&adjusted=true', {
    headers: { ...common, Referer: 'https://finance.daum.net/quotes/A005930' },
  });
  if (!r.ok) throw new Error(`Daum chart: HTTP ${r.status}`);
  const j = await r.json();
  const rows = (j?.data || []).filter(x => Number.isFinite(Number(x.tradePrice)) && Number(x.tradePrice) > 0);
  if (rows.length < 200) throw new Error(`Daum chart: only ${rows.length} valid daily bars`);
  return `${rows.length} bars`;
}

const [kospi, kosdaq, yf, dd] = await Promise.all([
  daumUniverse('KOSPI'),
  daumUniverse('KOSDAQ'),
  yahoo(),
  daumDaily(),
]);
console.log(`[data-check] KOSPI ${kospi} | KOSDAQ ${kosdaq} | Yahoo ${yf} | Daum chart ${dd}`);
