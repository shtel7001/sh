'use client';
import {useEffect,useMemo,useState} from 'react';
import * as XLSX from 'xlsx';
import PriceChart from './PriceChart';

type MarketMode='BOTH'|'KOSPI'|'KOSDAQ';
type Stock={name:string;code:string;market:'KOSPI'|'KOSDAQ';currentPrice:number|null;changePct:number|null;marketCap:number|null;sector:string|null;theme:string|null};
type Row=Stock&{ret5?:number;volumeScore?:number|null;newsScore?:number|null;supplyScore?:number|null;chartScore?:number|null;disclosureScore?:number|null;sectorScore?:number|null;penalty?:number;reasons?:string[];newsReasons?:string[];supplyReasons?:string[];news?:any[];detectedAt?:string;dataStatus?:string;error?:string;events?:any[];stats?:any;finalScore?:number;coverage?:number;stage?:string;radarScore?:number;historyLead?:number;spikeCount?:number;lastSpikeDate?:string;lastSpikePct?:number};
const maxes:{[k:string]:number}={volumeScore:25,newsScore:20,supplyScore:15,chartScore:15,disclosureScore:15,sectorScore:10};
const fmt=(n:any,d=0)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:d}):'-';
const pct=(n:any)=>typeof n==='number'?`${n>=0?'+':''}${n.toFixed(2)}%`:'-';
function enrichCalc(r:Row){
 let raw=0,max=0;for(const [k,m] of Object.entries(maxes)){const v=(r as any)[k];if(typeof v==='number'){raw+=v;max+=m;}}
 const base=max?raw/max*100:0;const current=Math.max(0,Math.min(100,base+(r.penalty||0)));
 const vals=(r.events||[]).flatMap((e:any)=>[30,20,10,5,3,1].map(x=>e[`d${x}`]?.score).filter((v:any)=>typeof v==='number'));
 const historyLead=vals.length?vals.reduce((a:number,b:number)=>a+b,0)/vals.length:0;
 const radar=Math.max(0,Math.min(100,current*.8+historyLead*.2));
 const ev=(r.events||[]).at(-1);
 return {...r,finalScore:+current.toFixed(1),coverage:Math.round(max),historyLead:+historyLead.toFixed(1),radarScore:+radar.toFixed(1),spikeCount:(r.events||[]).length,lastSpikeDate:ev?.date,lastSpikePct:ev?.spikePct,stage:radar>=80?'강한 전조':radar>=65?'전조 집중':radar>=45?'이상징후':'관찰'};
}

export default function Dashboard(){
 const [mode,setMode]=useState<MarketMode>('BOTH');
 const [period,setPeriod]=useState(120),[spikePct,setSpikePct]=useState(10),[topN,setTopN]=useState(100);
 const [universe,setUniverse]=useState<Stock[]>([]),[rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');
 const [progress,setProgress]=useState({done:0,total:0,ok:0,fail:0,start:0}),[query,setQuery]=useState(''),[selected,setSelected]=useState<Row|null>(null),[bars,setBars]=useState<any[]>([]);
 useEffect(()=>{try{const r=localStorage.getItem('psr_v4_latest');if(r)setRows(JSON.parse(r));const u=localStorage.getItem('psr_v4_universe');if(u){const x=JSON.parse(u);if(Date.now()-x.ts<6*3600000)setUniverse(x.stocks)}}catch{}},[]);
 async function loadUniverse(force=false){if(universe.length&&!force)return universe;setMsg('네이버 금융에서 KOSPI 500 + KOSDAQ 300 종목목록 수집 중…');const r=await fetch('/api/universe');const j=await r.json();if(!r.ok)throw new Error(j.error||'종목목록 수집 실패');const stocks=j.stocks||[];setUniverse(stocks);localStorage.setItem('psr_v4_universe',JSON.stringify({ts:Date.now(),stocks}));return stocks as Stock[];}
 function target(all:Stock[]){return mode==='BOTH'?all:all.filter(s=>s.market===mode);}
 async function scan(){setBusy(true);setRows([]);setMsg('과거 급등 종목과 급등 전조를 찾는 중…');try{
   const allStocks=await loadUniverse();const stocks=target(allStocks);if(!stocks.length)throw new Error('분석할 종목이 없습니다.');
   const started=Date.now();setProgress({done:0,total:stocks.length,ok:0,fail:0,start:started});let all:Row[]=[];
   for(let i=0;i<stocks.length;i+=12){const batch=stocks.slice(i,i+12);const r=await fetch('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stocks:batch,period,thresholds:{d1:spikePct,d3:99,d5:99,d10:99}})});const j=await r.json();if(!r.ok)throw new Error(j.error||'분석 API 실패');all=[...all,...j.results.map((x:Row)=>enrichCalc(x))];const ok=all.filter(x=>x.dataStatus==='ok').length;setProgress({done:all.length,total:stocks.length,ok,fail:all.length-ok,start:started});setMsg(`주가 분석 ${all.length}/${stocks.length} · 과거 +${spikePct}% 급등 이력 ${all.filter(x=>(x.events||[]).length).length}종목`);}
   let candidates=all.filter(x=>x.dataStatus==='ok'&&(x.events||[]).length>0).sort((a,b)=>(b.finalScore||0)-(a.finalScore||0));
   const pre=candidates.slice(0,Math.min(100,Math.max(40,topN)));setMsg(`과거 급등 ${candidates.length}종목 확인 · 현재 뉴스/수급 전조 보강 중…`);
   for(let i=0;i<pre.length;i+=20){const pack=pre.slice(i,i+20);const r=await fetch('/api/enrich',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stocks:pack})});if(!r.ok)continue;const j=await r.json();const map=new Map((j.results||[]).map((x:any)=>[x.code,x]));all=all.map(x=>{const e:any=map.get(x.code);return e?enrichCalc({...x,...e}):x;});}
   all=all.filter(x=>x.dataStatus==='ok'&&(x.events||[]).length>0).sort((a,b)=>(b.radarScore||0)-(a.radarScore||0));setRows(all);localStorage.setItem('psr_v4_latest',JSON.stringify(all));setMsg(`완료 · ${mode==='BOTH'?'KOSPI 500 + KOSDAQ 300':mode==='KOSPI'?'KOSPI 500':'KOSDAQ 300'} · 과거 급등 이력 ${all.length}종목 · 전조 점수순 정렬`);
 }catch(e){setMsg(e instanceof Error?e.message:'분석 실패');}finally{setBusy(false)}}
 async function openDetail(r:Row){setSelected(r);setBars([]);try{const x=await fetch(`/api/detail?code=${r.code}&market=${r.market}`);const j=await x.json();if(x.ok)setBars(j.bars||[]);}catch{}}
 async function logout(){await fetch('/api/auth/logout',{method:'POST'});location.href='/login'}
 const shown=useMemo(()=>rows.filter(r=>!query||r.name.includes(query)||r.code.includes(query)).slice(0,topN),[rows,query,topN]);
 const high=rows.filter(r=>(r.radarScore||0)>=70).length,mid=rows.filter(r=>(r.radarScore||0)>=55).length;
 function exportXlsx(){const data=shown.map(r=>({순위:shown.indexOf(r)+1,종목명:r.name,종목코드:r.code,시장:r.market,현재가:r.currentPrice,당일등락률:r.changePct,최근5일:r.ret5,전조매칭점수:r.radarScore,현재신호점수:r.finalScore,과거전조평균:r.historyLead,과거급등횟수:r.spikeCount,최근급등일:r.lastSpikeDate,최근급등률:r.lastSpikePct,거래량점수:r.volumeScore,뉴스점수:r.newsScore,수급점수:r.supplyScore,차트점수:r.chartScore,급등감점:r.penalty,포착이유:[...(r.reasons||[]),...(r.newsReasons||[]),...(r.supplyReasons||[])].join(' | '),최근뉴스:(r.news||[]).map((n:any)=>`${n.date?.slice(0,10)} ${n.title} ${n.link}`).join('\n')}));const ws=XLSX.utils.json_to_sheet(data);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'V4급등전조');XLSX.writeFile(wb,`급등전조레이더V4_${new Date().toISOString().slice(0,10)}.xlsx`);}
 const elapsed=progress.start?Math.round((Date.now()-progress.start)/1000):0;
 return <main className="app v4app">
   <header className="hero"><div><div className="eyebrow">PRE-SPIKE RADAR V4 · HISTORICAL LEAD SIGNAL</div><h1>과거 급등 전조 레이더 V4</h1><p>과거 급등 종목의 D-30~D-1 신호를 확인하고, 현재 비슷한 전조가 나타나는 종목을 점수화합니다.</p></div><button className="ghost" onClick={logout}>로그아웃</button></header>

   <section className="panel v2panel"><div className="panelHead"><h2>① 주가 급등 검색 조건</h2><span>{mode==='BOTH'?'KOSPI 500 + KOSDAQ 300':mode==='KOSPI'?'KOSPI 상위 500':'KOSDAQ 상위 300'}</span></div>
    <div className="marketChoice"><button className={mode==='BOTH'?'active':''} onClick={()=>setMode('BOTH')}>KOSPI 500 + KOSDAQ 300</button><button className={mode==='KOSPI'?'active':''} onClick={()=>setMode('KOSPI')}>KOSPI 500</button><button className={mode==='KOSDAQ'?'active':''} onClick={()=>setMode('KOSDAQ')}>KOSDAQ 300</button></div>
    <div className="quickRow"><b>빠른 설정</b>{[7,30,60,120,180,240].map(x=><button key={x} className={period===x?'active':''} onClick={()=>setPeriod(x)}>{x}거래일</button>)}</div>
    <Range title="최대 주가 검색기간" value={period} min={7} max={240} suffix=" 거래일" onChange={setPeriod}/>
    <Range title="급등 판정" value={spikePct} min={1} max={30} suffix="% 이상" onChange={setSpikePct}/>
    <div className="bigJudge"><span>급등 판정</span><strong>+{spikePct}% 이상</strong><small>전 거래일 종가 대비 하루 상승률</small></div>
   </section>

   <section className="panel v2panel"><div className="panelHead"><h2>② 급등 전조 검색 조건</h2><span>미래정보 누수 방지</span></div>
    <div className="leadDesc">급등 당일 데이터는 전조 계산에서 제외합니다. 급등 전 <b>D-30 · D-20 · D-10 · D-5 · D-3 · D-1</b>의 거래량·가격 구조를 학습용 비교값으로 만들고, 현재 거래량·차트·뉴스·수급 신호와 비교합니다.</div>
    <div className="quickRow"><b>결과 표시</b>{[20,50,100,150].map(x=><button key={x} className={topN===x?'active':''} onClick={()=>setTopN(x)}>Top {x}</button>)}</div>
    <div className="actionRow"><button className="primary bigAction" onClick={scan} disabled={busy}>{busy?'검색 진행 중…':'검색 시작'}</button><button className="excelAction" onClick={exportXlsx} disabled={!rows.length}>Excel 최신버전(.xlsx) 저장</button></div>
    {(busy||progress.done>0)&&<><div className="bar bigbar"><i style={{width:`${progress.total?progress.done/progress.total*100:0}%`}}/></div><div className="progressText">{progress.done}/{progress.total||0} 분석 · 성공 {progress.ok} · 실패 {progress.fail} · {elapsed}초</div></>}
    {msg&&<div className="sourceText">{msg}</div>}
   </section>

   <section className="statsV2"><article><span>검색 대상</span><b>{mode==='BOTH'?800:mode==='KOSPI'?500:300}</b><small>종목</small></article><article><span>과거 급등 이력</span><b>{rows.length}</b><small>종목</small></article><article><span>70점 이상</span><b>{high}</b><small>종목</small></article><article><span>55점 이상</span><b>{mid}</b><small>종목</small></article></section>

   <section className="resultPanel"><div className="sectionTitle"><div><h2>탐지 결과</h2><p>과거 {period}거래일 · 하루 +{spikePct}% 이상 급등 이력 · 현재 전조 매칭 점수순</p></div><span>{shown.length}종목</span></div>
    <input className="resultSearch" value={query} onChange={e=>setQuery(e.target.value)} placeholder="종목명·코드 검색"/>
    {!shown.length?<div className="empty">검색을 실행하면 과거 급등 이력이 있는 종목 가운데 현재 전조가 강한 종목이 표시됩니다.</div>:<div className="v2results">{shown.map((r,i)=><article className="v2row" key={`${r.market}-${r.code}`} onClick={()=>openDetail(r)}><div className="v2rank">{i+1}</div><div className="v2name"><b>{r.name}</b><small>{r.market} · {r.code}</small><em>상세 보기 ↗</em></div><div className="v2history"><span>과거 급등 이력</span><strong>{r.spikeCount}회</strong><small>{r.lastSpikeDate||'-'} · {pct(r.lastSpikePct)}</small></div><div className="v2score"><span>현재 전조 매칭</span><strong>{fmt(r.radarScore,1)}</strong><small>{r.stage} · 5일 {pct(r.ret5)}</small></div></article>)}</div>}
   </section>

   {selected&&<Detail row={selected} bars={bars} close={()=>setSelected(null)}/>}<footer>V4 점수는 상승 확률이 아니라 과거 급등 전 패턴과 현재 이상징후의 비교 점수입니다.</footer>
 </main>
}
function Range({title,value,min,max,suffix,onChange}:{title:string;value:number;min:number;max:number;suffix:string;onChange:(n:number)=>void}){return <div className="rangeBox"><div><span>{title}</span><b>{value}{suffix}</b></div><input type="range" min={min} max={max} value={value} onChange={e=>onChange(Number(e.target.value))}/><small><i>{min}{suffix.includes('%')?'%':'일'}</i><i>{max}{suffix.includes('%')?'%':'일'}</i></small></div>}
function Score({v,max}:{v:any,max:number}){return <span className={typeof v==='number'?'score':'score missing'}>{typeof v==='number'?`${v}/${max}`:'없음'}</span>}
function Detail({row,bars,close}:{row:Row;bars:any[];close:()=>void}){const reasons=[...(row.reasons||[]),...(row.newsReasons||[]),...(row.supplyReasons||[])];return <div className="modalBack" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><section className="modal"><button className="close" onClick={close}>×</button><div className="eyebrow">V4 PRE-SPIKE DETAIL</div><h2>{row.name} <small>{row.code} · {row.market}</small></h2><div className="detailHero"><div><span>전조 매칭 점수</span><b>{fmt(row.radarScore,1)}</b><small>현재 {fmt(row.finalScore,1)} · 과거 전조 평균 {fmt(row.historyLead,1)}</small></div><div><span>과거 급등</span><b>{row.spikeCount}회</b><small>최근 {row.lastSpikeDate||'-'} · {pct(row.lastSpikePct)}</small></div></div><h3>현재 포착 이유</h3>{reasons.length?<ul className="reasons">{reasons.map((x,i)=><li key={i}>{x}</li>)}</ul>:<div className="empty">현재 계산 가능한 전조 신호가 충분하지 않습니다.</div>}<div className="miniGrid detailScores"><label>거래량 <Score v={row.volumeScore} max={25}/></label><label>뉴스 <Score v={row.newsScore} max={20}/></label><label>수급 <Score v={row.supplyScore} max={15}/></label><label>차트 <Score v={row.chartScore} max={15}/></label><label>급등 감점 <b>{row.penalty||0}</b></label><label>최종 <b>{row.radarScore}</b></label></div><h3>최근 가격 차트</h3><PriceChart bars={bars} marks={(row.events||[]).map((e:any)=>e.date)}/><h3>과거 급등 전조</h3><div className="tableWrap"><table><thead><tr><th>급등일</th><th>급등률</th><th>D-30</th><th>D-20</th><th>D-10</th><th>D-5</th><th>D-3</th><th>D-1</th></tr></thead><tbody>{(row.events||[]).slice().reverse().map((e:any,i:number)=><tr key={i}><td>{e.date}</td><td>{pct(e.spikePct)}</td>{[30,20,10,5,3,1].map(x=><td key={x}>{e[`d${x}`]?.score??'-'}</td>)}</tr>)}</tbody></table></div><h3>최근 뉴스</h3>{row.news?.length?<div className="newsList">{row.news.map((n:any,i:number)=><a key={i} href={n.link} target="_blank" rel="noreferrer"><time>{n.date?.slice(0,10)}</time>{n.title}</a>)}</div>:<div className="empty">뉴스 데이터 없음 또는 API 미연결</div>}</section></div>}
