const common={
  'User-Agent':'Mozilla/5.0 us-low-point-cycle-radar/1.0',
  Accept:'application/json,text/plain,*/*',
};

async function sp500(){
  const u='https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv';
  const r=await fetch(u,{headers:common});
  if(!r.ok)throw new Error(`S&P source HTTP ${r.status}`);
  const t=await r.text();
  const lines=t.trim().split(/\r?\n/);
  if(lines.length<500)throw new Error(`S&P source only ${lines.length-1} rows`);
  return `${lines.length-1} rows`;
}

async function nasdaq(){
  const u=new URL('https://api.nasdaq.com/api/screener/stocks');
  u.searchParams.set('tableonly','true');
  u.searchParams.set('limit','25');
  u.searchParams.set('offset','0');
  u.searchParams.set('download','true');
  u.searchParams.set('exchange','nasdaq');
  const r=await fetch(u,{headers:{...common,Accept:'application/json, text/plain, */*',Referer:'https://www.nasdaq.com/market-activity/stocks/screener','Accept-Language':'en-US,en;q=0.9'}});
  if(!r.ok)throw new Error(`Nasdaq screener HTTP ${r.status}`);
  const j=await r.json();
  const rows=j?.data?.table?.rows||[];
  if(!Array.isArray(rows)||rows.length<10)throw new Error(`Nasdaq screener only ${rows.length} rows`);
  if(!rows[0]?.symbol||rows[0]?.marketCap==null)throw new Error('Nasdaq screener unexpected row shape');
  return `${rows.length} rows`;
}

async function yahoo(){
  const r=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=2y&interval=1d&includePrePost=false&events=div%2Csplits',{headers:common});
  if(!r.ok)throw new Error(`Yahoo HTTP ${r.status}`);
  const j=await r.json();
  const x=j?.chart?.result?.[0];
  const q=x?.indicators?.quote?.[0]||{};
  const a=x?.indicators?.adjclose?.[0]?.adjclose||q.close||[];
  const valid=a.filter(v=>Number.isFinite(Number(v))&&Number(v)>0);
  if(valid.length<240)throw new Error(`Yahoo only ${valid.length} bars`);
  return `${valid.length} bars`;
}

const [sp,nq,yf]=await Promise.all([sp500(),nasdaq(),yahoo()]);
console.log(`[data-check] S&P500 ${sp} | NASDAQ ${nq} | Yahoo ${yf}`);
