import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

export type UniverseStock = { name:string; code:string; market:'KOSPI'|'KOSDAQ'; currentPrice:number|null; changePct:number|null; marketCap:number|null; sector:string|null; theme:string|null };
export type Bar = { date:string; open:number; high:number; low:number; close:number; volume:number };

function num(s:string){ const n=Number(s.replace(/[,+%원]/g,'').trim()); return Number.isFinite(n)?n:null; }

async function fetchHtmlEuckr(url:string, revalidate=1800){
  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; PreSpikeRadar/3.0)'},next:{revalidate}} as RequestInit & {next:{revalidate:number}});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  const b=Buffer.from(await r.arrayBuffer());
  return iconv.decode(b,'EUC-KR');
}

export async function fetchUniverse(){
  const specs:[0|1,'KOSPI'|'KOSDAQ',number][]=[[0,'KOSPI',10],[1,'KOSDAQ',6]];
  const out:UniverseStock[]=[]; const errors:string[]=[];
  for(const [sosok,market,pages] of specs){
    for(let page=1;page<=pages;page++){
      try{
        const html=await fetchHtmlEuckr(`https://finance.naver.com/sise/sise_market_sum.naver?sosok=${sosok}&page=${page}`);
        const $=cheerio.load(html);
        $('table.type_2 tr').each((_,tr)=>{
          const a=$(tr).find('a.tltle');
          if(!a.length) return;
          const name=a.text().trim();
          const href=a.attr('href')||'';
          const code=(href.match(/code=(\d{6})/)||[])[1];
          if(!code) return;
          const cells=$(tr).find('td').map((_,td)=>$(td).text().replace(/\s+/g,' ').trim()).get();
          const currentPrice=num(cells[2]||'');
          const changePct=num(cells[4]||'');
          const marketCap=num(cells[6]||'');
          out.push({name,code,market,currentPrice,changePct,marketCap,sector:null,theme:null});
        });
      }catch(e){ errors.push(`${market} ${page}p: ${e instanceof Error?e.message:'오류'}`); }
    }
  }
  const uniq=[...new Map(out.map(x=>[`${x.market}-${x.code}`,x])).values()];
  return {stocks:uniq.slice(0,800), errors};
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
      if(!r.ok){ last=`HTTP ${r.status}`; await new Promise(x=>setTimeout(x,300*(attempt+1))); continue; }
      const j=await r.json();
      const z=j?.chart?.result?.[0];
      const ts:number[]=z?.timestamp||[]; const q=z?.indicators?.quote?.[0]||{};
      const bars:Bar[]=ts.map((v,i)=>({date:new Date(v*1000).toISOString().slice(0,10),open:q.open?.[i],high:q.high?.[i],low:q.low?.[i],close:q.close?.[i],volume:q.volume?.[i]}))
        .filter(x=>[x.open,x.high,x.low,x.close,x.volume].every(Number.isFinite));
      if(bars.length<20) throw new Error('가격 이력 부족');
      return bars.slice(-Math.max(days,130));
    }catch(e){ clearTimeout(t); last=e instanceof Error?e.message:'fetch error'; await new Promise(x=>setTimeout(x,300*(attempt+1))); }
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
