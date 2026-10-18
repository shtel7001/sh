import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SP500_CSV = 'https://raw.githubusercontent.com/datasets/s-and-p-500-constituents/main/data/constituents.csv';
const SP500_WIKI = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';

const sectors={'Financials':'금융','Information Technology':'정보기술','Health Care':'헬스케어','Industrials':'산업재','Consumer Discretionary':'경기소비재','Consumer Staples':'필수소비재','Communication Services':'커뮤니케이션','Energy':'에너지','Utilities':'유틸리티','Materials':'소재','Real Estate':'부동산','Technology':'정보기술','Finance':'금융','Healthcare':'헬스케어','Consumer Cyclical':'경기소비재','Consumer Defensive':'필수소비재','Basic Materials':'소재','Communication':'커뮤니케이션'};
const names={'AAPL':'애플','MSFT':'마이크로소프트','NVDA':'엔비디아','AMZN':'아마존','GOOGL':'알파벳','GOOG':'알파벳','META':'메타 플랫폼스','TSLA':'테슬라','AMD':'AMD','AVGO':'브로드컴','NFLX':'넷플릭스','PLTR':'팔란티어','INTC':'인텔','MU':'마이크론 테크놀로지','JPM':'JP모건 체이스','BAC':'뱅크오브아메리카','WFC':'웰스파고','C':'씨티그룹','BPOP':'포퓰러','TFSL':'TFS 파이낸셜','CINF':'신시내티 파이낸셜','EWBC':'이스트웨스트 뱅코프','CWST':'카셀라 웨이스트 시스템스','V':'비자','MA':'마스터카드','UNH':'유나이티드헬스','JNJ':'존슨앤드존슨','XOM':'엑슨모빌','CVX':'셰브론','COST':'코스트코','WMT':'월마트','HD':'홈디포','PG':'프록터앤드갬블','KO':'코카콜라','PEP':'펩시코','DIS':'월트디즈니','UBER':'우버','ORCL':'오라클','CRM':'세일즈포스','ADBE':'어도비','QCOM':'퀄컴','TXN':'텍사스 인스트루먼트','AMAT':'어플라이드 머티어리얼즈','LRCX':'램리서치','KLAC':'KLA','SNOW':'스노우플레이크','SHOP':'쇼피파이','WM':'웨이스트 매니지먼트','APD':'에어 프로덕츠','AFL':'애플랙','BEN':'프랭클린 리소시스','CCI':'크라운 캐슬','BNY':'BNY 멜론','BK':'BNY 멜론'};
const sectorKo=s=>sectors[String(s||'').trim()]||String(s||'미분류');
const sectorOverrides={'WFC':'금융','CINF':'금융','AFL':'금융','BEN':'금융','BK':'금융','BNY':'금융','BPOP':'금융','TFSL':'금융','EWBC':'금융','WM':'산업재','CWST':'산업재','APD':'소재','CCI':'부동산','AMT':'부동산','PLD':'부동산','O':'부동산','SPG':'부동산'};
const resolvedSector=(code,s)=>sectorOverrides[code]||sectorKo(s);
function normSymbol(s){ return String(s||'').trim().toUpperCase().replace(/[./\s]+/g,'-'); }
function parseCSV(text){
  const rows=[]; let row=[], f='', q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(q){
      if(ch==='"'){ if(text[i+1]==='"'){ f+='"'; i++; } else q=false; }
      else f+=ch;
    } else if(ch==='"') q=true;
    else if(ch===','){ row.push(f); f=''; }
    else if(ch==='\n'||ch==='\r'){
      if(ch==='\r'&&text[i+1]==='\n') i++;
      row.push(f); f=''; if(row.length>1||row[0]!=='') rows.push(row); row=[];
    } else f+=ch;
  }
  if(f!==''||row.length){ row.push(f); if(row.length>1||row[0]!=='') rows.push(row); }
  return rows;
}
function parseCap(v){
  if(v==null) return null;
  const s=String(v).trim().replace(/[$,\s]/g,'');
  const m=s.match(/^([0-9.]+)([TBMK])?$/i);
  if(m){
    const n=Number(m[1]); if(!Number.isFinite(n)||n<=0) return null;
    const u=(m[2]||'').toUpperCase();
    return n*({T:1e12,B:1e9,M:1e6,K:1e3,'':1}[u]||1);
  }
  const n=Number(s); return Number.isFinite(n)&&n>0?n:null;
}
function screenerRows(j){ const d=j&&j.data; return (d&&(d.rows||(d.table&&d.table.rows)))||[]; }
function cleanName(n){ return String(n||'').replace(/\s+(Class [A-Z] )?(Common|Ordinary|Capital|American Depositary|Depositary)\b.*$/i,'').trim(); }

async function nasdaqScreener(exchange){
  const url=`https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25000&offset=0&exchange=${exchange}&download=true`;
  const r=await fetch(url,{cache:'no-store',headers:{'User-Agent':UA,Accept:'application/json, text/plain, */*','Accept-Language':'en-US,en;q=0.9',Origin:'https://www.nasdaq.com',Referer:'https://www.nasdaq.com/'}});
  if(!r.ok) throw new Error(`Nasdaq screener ${exchange} HTTP ${r.status}`);
  return screenerRows(await r.json());
}

async function sp500Csv(){
  try{
    const r=await fetch(SP500_CSV,{cache:'no-store',headers:{'User-Agent':UA}});
    if(r.ok) return await r.text();
  }catch{}
  const w=await fetch(SP500_WIKI,{cache:'no-store',headers:{'User-Agent':'low-screener/1.0 (personal stock screener)'}});
  if(!w.ok) throw new Error(`S&P 500 list HTTP ${w.status}`);
  const html=await w.text();
  const table=(html.split('id="constituents"')[1]||'').split('</table>')[0];
  const strip=s=>s.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&#160;|&nbsp;/g,' ').replace(/\s+/g,' ').trim();
  const lines=['Symbol,Security'];
  for(const tr of table.split('<tr').slice(2)){
    const cells=[...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m=>strip(m[1]));
    if(cells.length>=2&&cells[0]) lines.push(`${cells[0]},"${cells[1].replace(/"/g,'""')}"`);
  }
  if(lines.length<100) throw new Error('S&P 500 list parse failed');
  return lines.join('\n');
}

async function buildNasdaq500(){
  const rows=await nasdaqScreener('nasdaq');
  const bad=/warrant|\bunits?\b|\brights?\b|preferred|\bnotes?\b/i;
  const seen=new Set(), out=[];
  for(const r of rows){
    const raw=String(r.symbol||'').trim(); if(!raw||/[\^\s]/.test(raw)) continue;
    const marketCap=parseCap(r.marketCap); if(!marketCap) continue;
    const name=String(r.name||raw); if(bad.test(name)) continue;
    const code=normSymbol(raw); if(seen.has(code)) continue; seen.add(code);
    out.push({code,name:cleanName(name)||code,marketCap,sector:resolvedSector(code,r.sector||r.industry)});
  }
  out.sort((a,b)=>b.marketCap-a.marketCap);
  return out.slice(0,500).map((x,i)=>({rank:i+1,code:x.code,name:x.name,nameKo:names[x.code]||null,sector:x.sector,current:null,marketCapB:x.marketCap/1e9,market:'NASDAQ',yahoo:x.code}));
}

async function buildSP500(){
  const [csv, caps]=await Promise.all([
    sp500Csv(),
    Promise.allSettled([nasdaqScreener('nasdaq'),nasdaqScreener('nyse'),nasdaqScreener('amex')])
  ]);
  const capMap=new Map();
  for(const z of caps){
    if(z.status!=='fulfilled') continue;
    for(const r of z.value){ const s=normSymbol(r.symbol), c=parseCap(r.marketCap); if(s&&c&&(!capMap.has(s)||c>capMap.get(s))) capMap.set(s,c); }
  }
  const rows=parseCSV(csv); if(rows.length<2) throw new Error('S&P 500 list empty');
  const head=rows[0].map(h=>h.trim().toLowerCase());
  const iSym=head.indexOf('symbol'); let iName=head.indexOf('security'); if(iName<0) iName=head.indexOf('name');
  if(iSym<0) throw new Error('S&P 500 CSV format changed');
  const iSector=head.findIndex(h=>['gics sector','sector','gics_sector'].includes(h));
  const seen=new Set(), out=[];
  for(const r of rows.slice(1)){
    const code=normSymbol(r[iSym]); if(!code||seen.has(code)) continue; seen.add(code);
    const marketCap=capMap.get(code)||0;
    out.push({code,name:(iName>=0&&r[iName])||code,marketCap,sector:resolvedSector(code,iSector>=0?r[iSector]:'')});
  }
  out.sort((a,b)=>b.marketCap-a.marketCap);
  return out.map((x,i)=>({rank:i+1,code:x.code,name:x.name,nameKo:names[x.code]||null,sector:x.sector,current:null,marketCapB:x.marketCap?x.marketCap/1e9:null,market:'S&P 500',yahoo:x.code}));
}

export async function GET(req){
  try{
    const q=new URL(req.url).searchParams;
    const market=q.get('market')==='nasdaq'?'nasdaq':'sp500';
    const limit=Math.min(500,Math.max(1,Number(q.get('limit')||500)));
    const items=(market==='nasdaq'?await buildNasdaq500():await buildSP500()).slice(0,limit);
    if(items.length<100) throw new Error(`${market} universe only ${items.length} rows`);
    return NextResponse.json({ok:true,source:market==='nasdaq'?'Nasdaq public screener':'GitHub S&P 500 + Nasdaq market-cap screener',market,count:items.length,items});
  }catch(e){
    return NextResponse.json({ok:false,error:String(e?.message||e)},{status:500});
  }
}
