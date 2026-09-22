'use client';
import {useEffect,useMemo,useState} from 'react';
import * as XLSX from 'xlsx';
import PriceChart from './PriceChart';

type Market='KOSPI'|'KOSDAQ';
type Stock={name:string;code:string;market:Market;currentPrice:number|null;changePct:number|null;marketCap:number|null};
type ChartBar={date:string;open:number;high:number;low:number;close:number;volume:number};
type Row=Stock&{dataStatus:string;match:boolean;score:number;error?:string;daily?:any;intraday?:any;reasons?:string[];chartBars?:ChartBar[];source?:string};
type Settings={lookbackDays:number;minScore:number;lowZoneMaxPct:number;nearMa5Pct:number;touchTolerancePct:number;cycleRisePct:number;cycleMaxBars:number;trendMinSlopePct:number;maxBelowMa60Pct:number;useIntraday:boolean;intradayBars:number};
const defaults:Settings={lookbackDays:20,minScore:58,lowZoneMaxPct:35,nearMa5Pct:2.5,touchTolerancePct:1.8,cycleRisePct:3,cycleMaxBars:7,trendMinSlopePct:0,maxBelowMa60Pct:3,useIntraday:false,intradayBars:6};
const fmt=(n:any,d=0)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:d}):'-';
const pct=(n:any,d=2)=>typeof n==='number'&&Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(d)}%`:'-';
function Field({label,value,onChange,min,max,step=1,unit=''}:{label:string;value:number;onChange:(v:number)=>void;min:number;max:number;step?:number;unit?:string}){return <div><label>{label}</label><input type="number" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/><small>{unit}</small></div>}
const marketText=(m:'ALL'|Market)=>m==='ALL'?'코스피+코스닥':m==='KOSPI'?'코스피':'코스닥';

export default function Dashboard(){
 const [universe,setUniverse]=useState<Stock[]>([]),[rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[query,setQuery]=useState(''),[market,setMarket]=useState<'ALL'|Market>('ALL');
 const [progress,setProgress]=useState({done:0,total:0,ok:0,fail:0,match:0,start:0});
 const [settings,setSettings]=useState<Settings>(defaults);
 useEffect(()=>{try{const u=JSON.parse(localStorage.getItem('ma5low_universe_v1')||'null');if(u&&Date.now()-u.ts<30*60*1000)setUniverse(u.stocks||[]);const r=JSON.parse(localStorage.getItem('ma5low_results_v1')||'[]');if(Array.isArray(r))setRows(r)}catch{}},[]);
 function set<K extends keyof Settings>(k:K,v:Settings[K]){setSettings(x=>({...x,[k]:v}))}
 async function loadUniverse(force=false){if(universe.length&&!force)return universe;setMsg('네이버금융에서 코스피·코스닥 종목목록을 수집 중입니다…');const r=await fetch('/api/universe',{cache:'no-store'});const j=await r.json();if(!r.ok)throw new Error(j.error||'종목목록 수집 실패');const stocks:Stock[]=j.stocks||[];setUniverse(stocks);localStorage.setItem('ma5low_universe_v1',JSON.stringify({ts:Date.now(),stocks}));const kc=stocks.filter(x=>x.market==='KOSPI').length,kq=stocks.filter(x=>x.market==='KOSDAQ').length;setMsg(`종목목록 완료 · KOSPI ${kc.toLocaleString()} / KOSDAQ ${kq.toLocaleString()}`);return stocks}
 async function callPack(pack:Stock[]){const r=await fetch('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stocks:pack,settings})});const j=await r.json();if(!r.ok)throw new Error(j.error||'스크리닝 API 오류');return (j.results||[]) as Row[]}
 async function scan(){
  setBusy(true);setRows([]);setMsg('저점매수 후보 스크리닝 준비 중…');
  try{
   const targetMarket=market,allStocks=await loadUniverse(),stocks=targetMarket==='ALL'?allStocks:allStocks.filter(x=>x.market===targetMarket);if(!stocks.length)throw new Error('분석할 종목이 없습니다.');
   const start=Date.now();let found:Row[]=[],ok=0,fail=0,match=0;setProgress({done:0,total:stocks.length,ok:0,fail:0,match:0,start});
   for(let i=0;i<stocks.length;i+=16){
    const pack=stocks.slice(i,i+16);let got=await callPack(pack);
    const failedCodes=new Set(got.filter(x=>x.dataStatus!=='ok').map(x=>x.code));
    if(failedCodes.size){await new Promise(r=>setTimeout(r,250));const retryStocks=pack.filter(x=>failedCodes.has(x.code));if(retryStocks.length){const retry=await callPack(retryStocks);const rm=new Map(retry.map(x=>[x.code,x]));got=got.map(x=>rm.get(x.code)||x)}}
    ok+=got.filter(x=>x.dataStatus==='ok').length;fail+=got.filter(x=>x.dataStatus!=='ok').length;match+=got.filter(x=>x.match).length;
    found=[...found,...got.filter(x=>x.match)];found.sort((a,b)=>(b.score-a.score)||((a.daily?.rangePositionPct??999)-(b.daily?.rangePositionPct??999)));
    setRows([...found]);setProgress({done:Math.min(i+pack.length,stocks.length),total:stocks.length,ok,fail,match,start});setMsg(`${marketText(targetMarket)} ${Math.min(i+pack.length,stocks.length).toLocaleString()} / ${stocks.length.toLocaleString()} 분석 · 저점후보 ${match}종목`);
   }
   localStorage.setItem('ma5low_results_v1',JSON.stringify(found));setMsg(`완료: ${marketText(targetMarket)} ${stocks.length.toLocaleString()}종목 중 우상향·5일선 저점후보 ${match}종목 포착 · 실패 ${fail}종목`);
  }catch(e){setMsg(e instanceof Error?e.message:'분석 실패')}finally{setBusy(false)}
 }
 async function refreshUniverse(){setBusy(true);try{localStorage.removeItem('ma5low_universe_v1');setUniverse([]);await loadUniverse(true)}catch(e){setMsg(e instanceof Error?e.message:'목록 갱신 실패')}finally{setBusy(false)}}
 async function logout(){await fetch('/api/auth/logout',{method:'POST'});location.href='/login'}
 const filtered=useMemo(()=>rows.filter(x=>(!query||x.name.includes(query)||x.code.includes(query))&&(market==='ALL'||x.market===market)),[rows,query,market]);
 function exportXlsx(){const data=filtered.map((r,i)=>({순위:i+1,시장:r.market,종목명:r.name,종목코드:r.code,현재가:r.currentPrice,등급:r.daily?.grade,종합점수:r.score,'추세점수':r.daily?.trendScore,'저점점수':r.daily?.lowScore,'반복점수':r.daily?.cycleScore,'5일선매매반복횟수':r.daily?.cycleCount,'최근구간내위치(0=저점,100=고점)':r.daily?.rangePositionPct,'5일선괴리(%)':r.daily?.distanceMa5Pct,'20일선괴리(%)':r.daily?.distanceMa20Pct,'60일선괴리(%)':r.daily?.distanceMa60Pct,'20일선기울기(%/bar)':r.daily?.ma20SlopePct,'20거래일수익률(%)':r.daily?.return20Pct,'30분봉보너스':r.intraday?.bonus||0,'데이터':r.source||'','네이버증권':`https://finance.naver.com/item/main.naver?code=${r.code}`,'포착이유':(r.reasons||[]).join(' | ')}));const ws=XLSX.utils.json_to_sheet(data);ws['!autofilter']={ref:ws['!ref']||'A1:A1'};ws['!cols']=Object.keys(data[0]||{}).map(k=>({wch:Math.min(42,Math.max(12,k.length+4))}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'5일선저점후보');XLSX.writeFile(wb,`KRX_5일선_저점매수_레이더_${new Date().toISOString().slice(0,10)}.xlsx`)}
 const elapsed=progress.start?Math.round((Date.now()-progress.start)/1000):0;
 return <main className="app">
  <header className="hero"><div><div className="eyebrow">PRIVATE · NAVER FINANCE + YAHOO FINANCE</div><h1>5일선 저점매수 · 우상향 스윙 레이더</h1><p>주가가 우상향하는 종목 중에서 5일선 근처로 눌릴 때 사고, 다시 벌어질 때 파는 흐름이 반복된 종목을 찾고 현재 다시 저점권에 온 후보부터 점수순으로 보여줍니다.</p></div><button className="ghost" onClick={logout}>로그아웃</button></header>
  <section className="ruleBox"><b>새 검색 방식</b><span>① 20일선 우상향 또는 최근 20거래일 상승</span><span>② 20일선·60일선 관계로 큰 추세 확인</span><span>③ 최근 {settings.lookbackDays}거래일 가격범위에서 현재 위치가 저점 쪽인지 계산</span><span>④ 현재가/저가가 5일선에 다시 가까워졌는지 확인</span><span>⑤ 과거 5일선 눌림 뒤 +{settings.cycleRisePct}% 이상 반등한 반복 횟수를 가산점으로 반영</span><span>※ 30분봉은 켜도 탈락조건이 아니라 저점반등 보너스만 줍니다.</span></section>
  <section className="controls">
   <Field label="검색기간" value={settings.lookbackDays} onChange={v=>set('lookbackDays',v)} min={1} max={60} unit="거래일"/>
   <Field label="최소 종합점수" value={settings.minScore} onChange={v=>set('minScore',v)} min={30} max={90} unit="점"/>
   <Field label="저점권 최대 위치" value={settings.lowZoneMaxPct} onChange={v=>set('lowZoneMaxPct',v)} min={5} max={70} unit="%"/>
   <Field label="5일선 괴리 허용" value={settings.nearMa5Pct} onChange={v=>set('nearMa5Pct',v)} min={.3} max={8} step={.1} unit="%"/>
   <Field label="5일선 저가 터치 허용" value={settings.touchTolerancePct} onChange={v=>set('touchTolerancePct',v)} min={.3} max={6} step={.1} unit="%"/>
   <Field label="매도 목표 반복폭" value={settings.cycleRisePct} onChange={v=>set('cycleRisePct',v)} min={1} max={15} step={.5} unit="%"/>
   <Field label="반복 확인 기간" value={settings.cycleMaxBars} onChange={v=>set('cycleMaxBars',v)} min={2} max={20} unit="거래일"/>
   <Field label="20일선 최소 기울기" value={settings.trendMinSlopePct} onChange={v=>set('trendMinSlopePct',v)} min={-.1} max={.3} step={.01} unit="%/bar"/>
   <Field label="60일선 아래 허용" value={settings.maxBelowMa60Pct} onChange={v=>set('maxBelowMa60Pct',v)} min={0} max={12} step={.5} unit="%"/>
   <Field label="30분봉 확인 개수" value={settings.intradayBars} onChange={v=>set('intradayBars',v)} min={3} max={20} unit="개"/>
  </section>
  <section className="toolbar"><select value={market} onChange={e=>setMarket(e.target.value as 'ALL'|Market)} disabled={busy}><option value="ALL">코스피+코스닥 전체</option><option value="KOSPI">코스피만</option><option value="KOSDAQ">코스닥만</option></select><label><input type="checkbox" checked={settings.useIntraday} onChange={e=>set('useIntraday',e.target.checked)} disabled={busy}/> 30분봉 저점반등 보너스</label><button className="primary" onClick={scan} disabled={busy}>{busy?'저점 후보 분석 중…':'저점 종목 스크리닝 시작'}</button><button onClick={refreshUniverse} disabled={busy}>종목목록 새로고침</button><button onClick={exportXlsx} disabled={!filtered.length}>Excel .xlsx 저장</button><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="종목명 / 코드 검색"/></section>
  {(busy||progress.done>0)&&<section className="progress"><div><b>{progress.done.toLocaleString()} / {progress.total.toLocaleString()}</b><span>저점후보 {progress.match} · 데이터성공 {progress.ok} · 실패 {progress.fail} · {elapsed}초</span></div><div className="bar"><i style={{width:`${progress.total?progress.done/progress.total*100:0}%`}}/></div></section>}
  {msg&&<div className="status">{msg}</div>}
  <section className="results"><div className="sectionTitle"><h2>우상향 · 5일선 저점 후보</h2><span>{filtered.length}종목</span></div>{!filtered.length?<div className="empty">아직 후보가 없습니다. 기본값은 기존 방식보다 훨씬 넓게 잡습니다. 그래도 적으면 최소 종합점수를 50점 전후로 낮춰 보세요.</div>:<div className="tableWrap"><table><thead><tr><th>순위</th><th>종목</th><th>등급</th><th>점수</th><th>저점위치</th><th>5일선</th><th>20일선기울기</th><th>20일수익률</th><th>5일선 반복</th><th>데이터</th><th>링크</th></tr></thead><tbody>{filtered.map((r,i)=><tr key={`${r.market}-${r.code}`}><td>{i+1}</td><td><a className="stockNameLink" href={`https://finance.naver.com/item/main.naver?code=${r.code}`} target="_blank" rel="noreferrer"><b>{r.name}</b><small>{r.market} · {r.code}</small></a></td><td><strong className="score">{r.daily?.grade||'-'}</strong></td><td><strong className="score">{fmt(r.score,1)}</strong></td><td>{fmt(r.daily?.rangePositionPct,1)}%</td><td className={(r.daily?.distanceMa5Pct||0)<=0?'down':'up'}>{pct(r.daily?.distanceMa5Pct)}</td><td>{pct(r.daily?.ma20SlopePct,3)}</td><td>{pct(r.daily?.return20Pct)}</td><td>{r.daily?.cycleCount||0}회</td><td>{r.source||'-'}</td><td><a className="naverBtn small" href={`https://finance.naver.com/item/main.naver?code=${r.code}`} target="_blank" rel="noreferrer">네이버증권</a></td></tr>)}</tbody></table></div>}</section>
  {filtered.length>0&&<section className="cards">{filtered.map((r,i)=><article key={`${r.market}-${r.code}`} className="card"><div className="rank">#{i+1}</div><div className="cardHead"><div><a className="cardStockLink" href={`https://finance.naver.com/item/main.naver?code=${r.code}`} target="_blank" rel="noreferrer"><h3>{r.name}</h3><small>{r.market} · {r.code} · {r.source}</small></a></div><strong>{r.daily?.grade} · {fmt(r.score,1)}점</strong></div><div className="metrics"><span>저점 위치 <b>{fmt(r.daily?.rangePositionPct,1)}%</b><small>0%가 최근 저점</small></span><span>5일선 괴리 <b>{pct(r.daily?.distanceMa5Pct)}</b></span><span>20일선 기울기 <b>{pct(r.daily?.ma20SlopePct,3)}</b></span><span>20일 수익률 <b>{pct(r.daily?.return20Pct)}</b></span><span>5일선 매매 반복 <b>{r.daily?.cycleCount||0}회</b></span><span>저점점수 <b>{fmt(r.daily?.lowScore,1)}</b></span></div><div className="chartTitle"><b>일봉 · 최근 60거래일</b><span>종가 / 5일 / 20일 / 60일선</span></div>{r.chartBars?.length?<PriceChart bars={r.chartBars}/>:<div className="chartMissing">차트 데이터 없음</div>}<div className="reasons">{(r.reasons||[]).map((x,j)=><em key={j}>{x}</em>)}</div><a className="naverBtn" href={`https://finance.naver.com/item/main.naver?code=${r.code}`} target="_blank" rel="noreferrer">네이버증권 상세보기 ↗</a></article>)}</section>}
  <footer>이 레이더는 우상향 추세에서 5일선 눌림·저점권을 자동 탐지하는 기술적 스크리너입니다. 실제 매매 전 거래량·공시·뉴스·시장상황을 함께 확인하세요.</footer>
 </main>
}
