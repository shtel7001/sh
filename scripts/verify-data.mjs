const headers = {
  'User-Agent': 'Mozilla/5.0 low-point-cycle-radar/1.0',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://finance.daum.net/domestic/market_cap',
};

async function daum(market) {
  const u = new URL('https://finance.daum.net/api/trend/market_capitalization');
  u.searchParams.set('page', '1');
  u.searchParams.set('perPage', '3');
  u.searchParams.set('fieldName', 'marketCap');
  u.searchParams.set('order', 'desc');
  u.searchParams.set('market', market);
  u.searchParams.set('pagination', 'true');
  const r = await fetch(u, { headers });
  if (!r.ok) throw new Error(`Daum ${market}: HTTP ${r.status}`);
  const j = await r.json();
  const rows = j?.data || [];
  if (!Array.isArray(rows) || rows.length < 3) throw new Error(`Daum ${market}: empty/short response`);
  const first = rows[0] || {};
  if (!first.symbolCode || !first.name || !Number(first.marketCap)) throw new Error(`Daum ${market}: unexpected row shape`);
  return `${first.name}(${first.symbolCode})`;
}

const [kospi, kosdaq] = await Promise.all([daum('KOSPI'), daum('KOSDAQ')]);
console.log(`[data-check] KOSPI ${kospi} | KOSDAQ ${kosdaq}`);
