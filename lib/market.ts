import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

export type UniverseStock = { name:string; code:string; market:'KOSPI'|'KOSDAQ'; currentPrice:number|null; changePct:number|null; marketCap:number|null; sector:string|null; theme:string|null };
export type Bar = { date:string; open:number; high:number; low:number; close:number; volume:number };

function num(s:unknown){
  if(typeof s==='number') return Number.isFinite(s)?s:null;
  if(typeof s!=='string') return null;
  const n=Number(s.replace(/[,+%원\s]/g,'').trim());
  return Number.isFinite(n)?n:null;
}

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

async function fetchWithTimeout(url:string, init:RequestInit={}, timeout=9000){
  const ctl=new AbortController();
  const timer=setTimeout(()=>ctl.abort(),timeout);
  try{
    return await fetch(url,{...init,signal:ctl.signal});
  }finally{ clearTimeout(timer); }
}

async function fetchJson(url:string, revalidate=1800){
  let last='';
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetchWithTimeout(url,{headers:{
        'User-Agent':'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
        'Accept':'application/json, text/plain, */*',
        'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.6',
        'Referer':'https://m.stock.naver.com/'
      },next:{revalidate}} as RequestInit & {next:{revalidate:number}});
      if(!r.ok){ last=`HTTP ${r.status}`; await sleep(250*(attempt+1)); continue; }
      const ct=r.headers.get('content-type')||'';
      const text=await r.text();
      if(!ct.includes('json') && !text.trim().startsWith('{') && !text.trim().startsWith('[')){
        last='JSON 아닌 응답'; await sleep(250*(attempt+1)); continue;
      }
      return JSON.parse(text);
    }catch(e){ last=e instanceof Error?e.message:'fetch error'; await sleep(250*(attempt+1)); }
  }
  throw new Error(last||'JSON 수집 실패');
}

async function fetchHtmlEuckr(url:string, revalidate=1800){
  const r=await fetchWithTimeout(url,{headers:{
    'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
    'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.6',
    'Referer':'https://finance.naver.com/'
  },next:{revalidate}} as RequestInit & {next:{revalidate:number}});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  const b=Buffer.from(await r.arrayBuffer());
  const ct=(r.headers.get('content-type')||'').toLowerCase();
  if(ct.includes('utf-8')) return b.toString('utf8');
  return iconv.decode(b,'EUC-KR');
}

function pickArray(j:any):any[]{
  if(Array.isArray(j)) return j;
  for(const k of ['stocks','result','items','stockList','data']) if(Array.isArray(j?.[k])) return j[k];
  if(Array.isArray(j?.result?.stocks)) return j.result.stocks;
  if(Array.isArray(j?.result?.items)) return j.result.items;
  return [];
}

function normalizeStock(x:any, market:'KOSPI'|'KOSDAQ'):UniverseStock|null{
  const code=String(x?.itemCode ?? x?.itemcode ?? x?.stockCode ?? x?.code ?? '').match(/\d{6}/)?.[0]||'';
  const name=String(x?.stockName ?? x?.name ?? x?.itemName ?? '').trim();
  if(!code||!name) return null;
  return {
    name,
    code,
    market,
    currentPrice:num(x?.closePrice ?? x?.currentPrice ?? x?.nowVal ?? x?.price),
    changePct:num(x?.fluctuationsRatio ?? x?.changeRate ?? x?.changePct ?? x?.rate),
    marketCap:num(x?.marketValue ?? x?.marketCap ?? x?.marketValueAmount),
    sector:null,
    theme:null
  };
}

async function fetchUniverseMobile(market:'KOSPI'|'KOSDAQ', target:number){
  const out:UniverseStock[]=[];
  const pageSize=100;
  const pages=Math.ceil(target/pageSize);
  for(let page=1;page<=pages;page++){
    const url=`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=${pageSize}`;
    const j=await fetchJson(url,900);
    const rows=pickArray(j);
    if(!rows.length) throw new Error(`${market} mobile JSON ${page}p 빈 응답`);
    for(const x of rows){ const s=normalizeStock(x,market); if(s) out.push(s); }
  }
  return out.slice(0,target);
}

async function fetchUniverseFrontApi(market:'KOSPI'|'KOSDAQ', target:number){
  const out:UniverseStock[]=[];
  const pageSize=100;
  const pages=Math.ceil(target/pageSize);
  for(let page=1;page<=pages;page++){
    const url=`https://m.stock.naver.com/front-api/stock/domestic/stockList?sortType=marketValue&category=${market}&page=${page}&pageSize=${pageSize}`;
    const j=await fetchJson(url,900);
    const rows=pickArray(j);
    if(!rows.length) throw new Error(`${market} front-api ${page}p 빈 응답`);
    for(const x of rows){ const s=normalizeStock(x,market); if(s) out.push(s); }
  }
  return out.slice(0,target);
}

async function fetchUniversePc(market:'KOSPI'|'KOSDAQ', target:number){
  const sosok=market==='KOSPI'?0:1;
  const pages=Math.ceil(target/50);
  const out:UniverseStock[]=[];
  for(let page=1;page<=pages;page++){
    const html=await fetchHtmlEuckr(`https://finance.naver.com/sise/sise_market_sum.naver?sosok=${sosok}&page=${page}`);
    const $=cheerio.load(html);
    let pageRows=0;
    $('table.type_2 tr, table.type2 tr').each((_,tr)=>{
      const a=$(tr).find('a.tltle, a[href*="/item/main.naver?code="]').first();
      if(!a.length) return;
      const name=a.text().trim();
      const href=a.attr('href')||'';
      const code=(href.match(/code=(\d{6})/)||[])[1];
      if(!code||!name) return;
      const cells=$(tr).find('td').map((_,td)=>$(td).text().replace(/\s+/g,' ').trim()).get();
      out.push({name,code,market,currentPrice:num(cells[2]||''),changePct:num(cells[4]||''),marketCap:num(cells[6]||''),sector:null,theme:null});
      pageRows++;
    });
    if(pageRows===0) throw new Error(`${market} PC ${page}p 파싱 0건`);
  }
  return out.slice(0,target);
}

export async function fetchUniverse(){
  const specs:[market:'KOSPI'|'KOSDAQ',target:number][]=[['KOSPI',500],['KOSDAQ',300]];
  const out:UniverseStock[]=[];
  const errors:string[]=[];
  const sources:string[]=[];

  for(const [market,target] of specs){
    let rows:UniverseStock[]=[];
    try{
      rows=await fetchUniverseMobile(market,target);
      if(rows.length<Math.min(target,50)) throw new Error(`${market} mobile JSON ${rows.length}건`);
      sources.push(`${market}:mobile-json(${rows.length})`);
    }catch(e1){
      errors.push(`${market} mobile: ${e1 instanceof Error?e1.message:'오류'}`);
      try{
        rows=await fetchUniverseFrontApi(market,target);
        if(rows.length<Math.min(target,50)) throw new Error(`${market} front-api ${rows.length}건`);
        sources.push(`${market}:front-api(${rows.length})`);
      }catch(e2){
        errors.push(`${market} front-api: ${e2 instanceof Error?e2.message:'오류'}`);
        try{
          rows=await fetchUniversePc(market,target);
          if(rows.length<Math.min(target,50)) throw new Error(`${market} PC ${rows.length}건`);
          sources.push(`${market}:pc-html(${rows.length})`);
        }catch(e3){
          errors.push(`${market} pc: ${e3 instanceof Error?e3.message:'오류'}`);
          rows=[];
        }
      }
    }
    out.push(...rows.slice(0,target));
  }

  const uniq=[...new Map(out.map(x=>[`${x.market}-${x.code}`,x])).values()];
  console.log('[universe]',{count:uniq.length,sources,errors});
  if(!uniq.length) throw new Error(`네이버 종목목록 수집 0건 · ${errors.slice(-4).join(' / ')}`);
  return {stocks:uniq.slice(0,800),errors,sources};
}

export function yahooSymbol(code:string, market:'KOSPI'|'KOSDAQ'){ return `${code}.${market==='KOSPI'?'KS':'KQ'}`; }

export async function fetchYahooBars(code:string,market:'KOSPI'|'KOSDAQ',days=180):Promise<Bar[]> {
  const symbol=yahooSymbol(code,market);
  const period1=Math.floor((Date.now()-days*2.4*86400000)/1000);
  const period2=Math.floor(Date.now()/1000)+86400;
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`;
  let last='';
  for(let attempt=0;attempt<3;attempt++){
    const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),6500);
    try{
      const r=await fetch(url,{signal:ctl.signal,headers:{'User-Agent':'Mozilla/5.0'},next:{revalidate:900}} as RequestInit & {next:{revalidate:number}});
      clearTimeout(t);
      if(!r.ok){ last=`HTTP ${r.status}`; await sleep(300*(attempt+1)); continue; }
      const j=await r.json();
      const z=j?.chart?.result?.[0];
      const ts:number[]=z?.timestamp||[]; const q=z?.indicators?.quote?.[0]||{};
      const bars:Bar[]=ts.map((v,i)=>({date:new Date(v*1000).toISOString().slice(0,10),open:q.open?.[i],high:q.high?.[i],low:q.low?.[i],close:q.close?.[i],volume:q.volume?.[i]}))
        .filter(x=>[x.open,x.high,x.low,x.close,x.volume].every(Number.isFinite));
      if(bars.length<20) throw new Error('가격 이력 부족');
      return bars.slice(-Math.max(days,130));
    }catch(e){ clearTimeout(t); last=e instanceof Error?e.message:'fetch error'; await sleep(300*(attempt+1)); }
  }
  throw new Error(last||'Yahoo Finance 수집 실패');
}

export async function fetchInvestorFlow(code:string){
  try{
    const html=await fetchHtmlEuckr(`https://finance.naver.com/item/frgn.naver?code=${code}`,900);
    const $=cheerio.load(html); const rows:{date:string;inst:number;foreign:number}[]=[];
    $('table.type2 tr').each((_,tr)=>{
      const tds=$(tr).find('td').map((_,td)=>$(td).text().replace(/\s+/g,' ').trim()).get();
      if(tds.length<7 || !/^\d{4}\.\d{2}\.\d{2}/.test(tds[0]||'')) return;
      const inst=num(tds[5]||''); const foreign=num(tds[6]||'');
      if(inst!==null&&foreign!==null) rows.push({date:tds[0],inst,foreign});
    });
    return rows.slice(0,10);
  }catch{return null;}
}
