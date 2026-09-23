const headers = {
  'User-Agent': 'Mozilla/5.0 low-point-cycle-radar/1.0',
  Accept: 'application/json, text/plain, */*',
};

async function naver(category) {
  const u = new URL('https://m.stock.naver.com/front-api/stock/domestic/stockList');
  u.searchParams.set('sortType', 'marketValue');
  u.searchParams.set('category', category);
  u.searchParams.set('page', '1');
  u.searchParams.set('pageSize', '3');
  const r = await fetch(u, {
    headers: { ...headers, Referer: 'https://m.stock.naver.com/domestic/home/stockList/marketValue' },
  });
  if (!r.ok) throw new Error(`Naver ${category}: HTTP ${r.status}`);
  const raw = await r.json();
  const payload = raw?.isSuccess === true ? raw.result : raw;
  const rows = Array.isArray(payload) ? payload : (payload?.stocks || []);
  if (!Array.isArray(rows) || rows.length < 3) throw new Error(`Naver ${category}: empty/short response`);
  const first = rows[0] || {};
  const code = first.itemCode || first.stockCode || first.code;
  const name = first.stockName || first.itemName || first.name;
  if (!code || !name) throw new Error(`Naver ${category}: unexpected stock row shape`);
  return `${name}(${code})`;
}

async function yahoo() {
  const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/005930.KS?range=1y&interval=1d&includePrePost=false', {
    headers: { 'User-Agent': 'Mozilla/5.0 low-point-cycle-radar/1.0' },
  });
  if (!r.ok) throw new Error(`Yahoo: HTTP ${r.status}`);
  const j = await r.json();
  const x = j?.chart?.result?.[0];
  const closes = x?.indicators?.quote?.[0]?.close || [];
  const valid = closes.filter(v => Number.isFinite(Number(v)) && Number(v) > 0);
  if (valid.length < 20) throw new Error(`Yahoo: only ${valid.length} valid bars`);
  return `${valid.length} bars`;
}

const [kospi, kosdaq, yf] = await Promise.all([naver('KOSPI'), naver('KOSDAQ'), yahoo()]);
console.log(`[data-check] KOSPI ${kospi} | KOSDAQ ${kosdaq} | Yahoo ${yf}`);
