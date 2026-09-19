'use client';
import {useEffect,useMemo,useState} from 'react';
import * as XLSX from 'xlsx';
import PriceChart from './PriceChart';

type MarketMode='BOTH'|'KOSPI'|'KOSDAQ'|'CUSTOM';
type Stock={name:string;code:string;market:'KOSPI'|'KOSDAQ';currentPrice:number|null;changePct:number|null;marketCap:number|null;sector:string|null;theme:string|null};
type Row=Stock&{
 dataStatus?:string;error?:string;currentPrice:number|null;changePct:number|null;ret3?:number;ret5?:number;ret20?:number;volumeRatio?:number;rsi?:number;maGap?:number|null;
 volumeEarly?:number;quietPrice?:number;maStructure?:number;convergence?:number;momentum?:number;historySimilarity?:number;historySimilarityPct?:number;quantScore?:number;
 runPenalty?:number;fakeoutRisk?:number;fakeoutPenalty?:number;preSpikeEligible?:boolean;reasons?:string[];riskReasons?:string[];
 spikeCount?:number;lastSpikeDate?:string|null;lastSpikePct?:number|null;spikeDates?:{date:string;pct:number}[];
 newsVelocityScore?:number|null;keywordNoveltyScore?:number|null;sourceDiversityScore?:number|null;themeConfirmationScore?:number|null;flowScore?:number|null;
 keywords?:string[];news?:any[];newsReasons?:string[];flowReasons?:string[];coverage?:number;rawScore?:number;radarScore?:number;stage?:string;
};

const maxMap:{[k:string]:number}={volumeEarly:20,quietPrice:10,maStructure:10,convergence:8,momentum:7,historySimilarity:15,newsVelocityScore:8,keywordNoveltyScore:7,flowScore:5,sourceDiversityScore:5,themeConfirmationScore:5};
const fmt=(n:any,d=0)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:d}):'-';
const pct=(n:any)=>typeof n==='number'&&Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(2)}%`:'-';
const clamp=(n:number,min=0,max=100)=>Math.max(min,Math.min(max,n));

function finalize(r:Row):Row{
 let raw=0,coverage=0;
 for(const [k,m] of Object.entries(maxMap)){
   const v=(r as any)[k];
   if(typeof v==='number'&&Number.isFinite(v)){raw+=Math.max(0,Math.min(m,v));coverage+=m;}
 }
 const normalized=coverage?raw/coverage*100:0;
 const score=clamp(normalized+(r.runPenalty||0)+(r.fakeoutPenalty||0));
 const stage=score>=82?'강한 선행 전조':score>=70?'전조 집중':score>=55?'이상징후':score>=40?'관심':'관찰';
 return {...r,rawScore:+raw.toFixed(1),coverage,radarScore:+score.toFixed(1),stage};
}

export default function Dashboard(){
 const [mode,setMode]=useState<MarketMode>('BOTH');
 const [period,setPeriod]=useState(180),[spikePct,setSpikePct]=useState(10),[topN,setTopN]=useState(80),[excludeRan,setExcludeRan]=useState(true);
 const [custom,setCustom]=useState('삼성전자, SK하이닉스');
 const [universe,setUniverse]=useState<Stock[]>([]),[rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');
 const [progress,setProgress]=useState({done:0,total:0,ok:0,fail:0,start:0}),[query,setQuery]=useState(''),[selected,setSelected]=useState<Row|null>(null),[bars,setBars]=useState<any[]>([]);

 useEffect(()=>{try{const r=localStorage.getItem('psr_v5_latest');if(r)setRows(JSON.parse(r));const u=localStorage.getItem('psr_v5_universe');if(u){const x=JSON.parse(u);if(Date.now()-x.ts<6*3600000)setUniverse(x.stocks);}}catch{}},[]);

 async function loadUniverse(force=false){
   if(universe.length&&!force)return universe;
   setMsg('네이버 금융에서 KOSPI 500 + KOSDAQ 300 종목목록 수집 중…');
   const r=await fetch('/api/universe'); const j=await r.json();
   if(!r.ok)throw new Error(j.error||'종목목록 수집 실패');
   const stocks=j.stocks||[]; setUniverse(stocks); localStorage.setItem('psr_v5_universe',JSON.stringify({ts:Date.now(),stocks})); return stocks as Stock[];
 }

 function pickTargets(all:Stock[]){
   if(mode==='BOTH')return all;
   if(mode==='KOSPI'||mode==='KOSDAQ')return all.filter(s=>s.market===mode);
   const toks=custom.split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean);
   const picked:Stock[]=[];
   for(const t of toks){
     const code=t.match(/\d{6}/)?.[0];
     let hit=code?all.find(s=>s.code===code):all.find(s=>s.name===t);
     if(!hit&&!code)hit=all.find(s=>s.name.includes(t)||t.includes(s.name));
     if(hit&&!picked.some(x=>x.code===hit!.code))picked.push(hit);
   }
   return picked;
 }

 async function scan(){
   setBusy(true); setRows([]); setMsg('1단계 · 현재 전 종목의 숫자 신호부터 확인 중…');
   try{
     const allStocks=await loadUniverse(); const stocks=pickTargets(allStocks);
     if(!stocks.length)throw new Error(mode==='CUSTOM'?'입력한 종목을 찾지 못했습니다. 종목명 또는 6자리 코드를 확인해 주세요.':'분석할 종목이 없습니다.');
     const started=Date.now(); setProgress({done:0,total:stocks.length,ok:0,fail:0,start:started}); let all:Row[]=[];
     for(let i=0;i<stocks.length;i+=12){
       const batch=stocks.slice(i,i+12);
       const r=await fetch('/api/v5scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stocks:batch,period,spikePct})});
       const j=await r.json(); if(!r.ok)throw new Error(j.error||'V5 가격 분석 실패');
       all=[...all,...(j.results||[]).map((x:Row)=>finalize(x))];
       const ok=all.filter(x=>x.dataStatus==='ok').length;
       setProgress({done:all.length,total:stocks.length,ok,fail:all.length-ok,start:started});
       setMsg(`1단계 · 숫자 신호 ${all.length}/${stocks.length} · 아직 미급등 ${all.filter(x=>x.preSpikeEligible).length}종목`);
     }

     const okRows=all.filter(x=>x.dataStatus==='ok');
     const pre=okRows.filter(x=>x.preSpikeEligible).sort((a,b)=>(b.quantScore||0)-(a.quantScore||0));
     const enrichCount=mode==='CUSTOM'?pre.length:Math.min(pre.length,Math.max(120,topN*2));
     const enrichTargets=pre.slice(0,enrichCount);
     setMsg(`2단계 · 상위 ${enrichTargets.length}종목 뉴스 증가·새 키워드·외국인/기관 수급 보강 중…`);

     for(let i=0;i<enrichTargets.length;i+=20){
       const pack=enrichTargets.slice(i,i+20);
       const r=await fetch('/api/v5enrich',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stocks:pack})});
       if(!r.ok)continue;
       const j=await r.json(); const map=new Map((j.results||[]).map((x:any)=>[x.code,x]));
       all=all.map(x=>{const e:any=map.get(x.code);return e?finalize({...x,...e,news:e.items,newsReasons:e.reasons}):finalize(x);});
       setMsg(`2단계 · 뉴스·수급 보강 ${Math.min(i+20,enrichTargets.length)}/${enrichTargets.length}`);
     }

     all=all.map(finalize).sort((a,b)=>(b.radarScore||0)-(a.radarScore||0));
     setRows(all); localStorage.setItem('psr_v5_latest',JSON.stringify(all));
     setMsg(`완료 · ${stocks.length}종목 분석 · 미급등 후보 ${all.filter(x=>x.preSpikeEligible).length}종목 · 전조점수순 정렬`);
   }catch(e){setMsg(e instanceof Error?e.message:'분석 실패');}finally{setBusy(false);}
 }

 async function openDetail(r:Row){
   setSelected(r); setBars([]);
   try{const x=await fetch(`/api/detail?code=${r.code}&market=${r.market}`);const j=await x.json();if(x.ok)setBars(j.bars||[]);}catch{}
 }
 async function logout(){await fetch('/api/auth/logout',{method:'POST'});location.href='/login';}

 const filtered=useMemo(()=>rows.filter(r=>(!excludeRan||r.preSpikeEligible)&&(!query||r.name.includes(query)||r.code.includes(query))).slice(0,topN),[rows,query,topN,excludeRan]);
 const eligible=rows.filter(x=>x.preSpikeEligible).length,high=rows.filter(x=>x.preSpikeEligible&&(x.radarScore||0)>=70).length,excluded=rows.filter(x=>!x.preSpikeEligible).length;
 const elapsed=progress.start?Math.round((Date.now()-progress.start)/1000):0;

 function exportXlsx(){
   const data=filtered.map((r,i)=>({순위:i+1,종목명:r.name,종목코드:r.code,시장:r.market,현재가:r.currentPrice,당일등락률:r.changePct,최근3일:r.ret3,최근5일:r.ret5,전조점수:r.radarScore,데이터커버리지:r.coverage,미급등후보:r.preSpikeEligible?'예':'아니오',거래량선행:r.volumeEarly,가격미반영:r.quietPrice,이평구조:r.maStructure,이평수렴:r.convergence,모멘텀:r.momentum,과거패턴유사:r.historySimilarity,과거패턴유사도:r.historySimilarityPct,뉴스증가:r.newsVelocityScore,신규키워드:r.keywordNoveltyScore,수급:r.flowScore,출처다양성:r.sourceDiversityScore,테마확인:r.themeConfirmationScore,거래량배수:r.volumeRatio,RSI:r.rsi,가짜돌파위험:r.fakeoutRisk,급등감점:r.runPenalty,과거급등횟수:r.spikeCount,최근급등일:r.lastSpikeDate,최근급등률:r.lastSpikePct,키워드:(r.keywords||[]).join(', '),포착이유:[...(r.reasons||[]),...(r.newsReasons||[]),...(r.flowReasons||[])].join(' | '),최근뉴스:(r.news||[]).map((n:any)=>`${n.date?.slice(0,10)} ${n.title} ${n.link}`).join('\n')}));
   const ws=XLSX.utils.json_to_sheet(data); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'V5급등전조'); XLSX.writeFile(wb,`급등전조사전탐지V5_${new Date().toISOString().slice(0,10)}.xlsx`);
 }

 return <main className="app v5app">
   <header className="hero v5hero"><div><div className="eyebrow">PRE-SPIKE EARLY RADAR V5 · NO LOOK-AHEAD</div><h1>급등 전조 사전탐지 레이더 V5</h1><p>뉴스가 크게 터진 뒤가 아니라, <b>가격이 아직 덜 움직인 상태의 숫자 이상징후</b>를 먼저 찾고 과거 급등 직전 패턴·뉴스 변화·수급으로 확인합니다.</p></div><button className="ghost" onClick={logout}>로그아웃</button></header>

   <section className="v5flow">
    <article><b>1</b><span>거래량 이상</span><small>가격보다 먼저 움직이는 거래량</small></article><i>→</i><article><b>2</b><span>차트 구조</span><small>5·20·60일선 수렴/상승</small></article><i>→</i><article><b>3</b><span>과거 유사도</span><small>급등 전 D-10~D-1 비교</small></article><i>→</i><article><b>4</b><span>뉴스·수급</span><small>언급속도·새 키워드·매집</small></article><i>→</i><article><b>5</b><span>추격 제거</span><small>이미 오른 종목 감점·제외</small></article>
   </section>

   <section className="panel v2panel"><div className="panelHead"><h2>① 검색할 종목 범위</h2><span>원하는 종목만 직접 지정 가능</span></div>
    <div className="marketChoice v5choices"><button className={mode==='BOTH'?'active':''} onClick={()=>setMode('BOTH')}>KOSPI 500 + KOSDAQ 300</button><button className={mode==='KOSPI'?'active':''} onClick={()=>setMode('KOSPI')}>KOSPI 500</button><button className={mode==='KOSDAQ'?'active':''} onClick={()=>setMode('KOSDAQ')}>KOSDAQ 300</button><button className={mode==='CUSTOM'?'active':''} onClick={()=>setMode('CUSTOM')}>내가 정한 종목</button></div>
    {mode==='CUSTOM'&&<div className="customBox"><label>종목명 또는 6자리 코드 · 쉼표/줄바꿈으로 여러 종목 입력</label><textarea value={custom} onChange={e=>setCustom(e.target.value)} placeholder={'삼성전자, SK하이닉스\n005930, 000660'}/></div>}
   </section>

   <section className="panel v2panel"><div className="panelHead"><h2>② 과거 급등 학습 조건</h2><span>급등 당일 이후 정보는 사용하지 않음</span></div>
    <div className="quickRow"><b>과거 검색기간</b>{[60,120,180,240].map(x=><button key={x} className={period===x?'active':''} onClick={()=>setPeriod(x)}>{x}거래일</button>)}</div>
    <Range title="과거 패턴 검색기간" value={period} min={30} max={240} suffix=" 거래일" onChange={setPeriod}/>
    <Range title="과거 급등 판정" value={spikePct} min={3} max={30} suffix="% 이상" onChange={setSpikePct}/>
    <div className="leadDesc">과거 +{spikePct}% 이상 급등일의 <b>D-10 · D-5 · D-3 · D-1</b>만 비교합니다. 급등 당일과 이후 정보는 전조 유사도 계산에 넣지 않습니다.</div>
   </section>

   <section className="panel v2panel"><div className="panelHead"><h2>③ 현재 사전신호 검색</h2><span>100점 종합점수</span></div>
    <div className="scoreGuide"><span>거래량 20</span><span>가격 미반영 10</span><span>이평 구조 10</span><span>20·60 수렴 8</span><span>모멘텀 7</span><span>과거유사 15</span><span>뉴스·키워드 15</span><span>수급 5</span><span>출처·테마 10</span></div>
    <div className="quickRow"><b>결과 표시</b>{[20,50,80,100].map(x=><button key={x} className={topN===x?'active':''} onClick={()=>setTopN(x)}>Top {x}</button>)}</div>
    <label className="checkRow"><input type="checkbox" checked={excludeRan} onChange={e=>setExcludeRan(e.target.checked)}/><span>이미 급등한 종목 제외</span><small>1일 +5% 이상 또는 3일 +10% 이상 또는 5일 +12% 이상은 기본 제외</small></label>
    <div className="actionRow"><button className="primary bigAction" onClick={scan} disabled={busy}>{busy?'V5 검색 진행 중…':'V5 사전신호 검색 시작'}</button><button className="excelAction" onClick={exportXlsx} disabled={!filtered.length}>Excel 최신버전(.xlsx) 저장</button></div>
    {(busy||progress.done>0)&&<><div className="bar bigbar"><i style={{width:`${progress.total?progress.done/progress.total*100:0}%`}}/></div><div className="progressText">{progress.done}/{progress.total||0} 분석 · 성공 {progress.ok} · 실패 {progress.fail} · {elapsed}초</div></>}
    {msg&&<div className="sourceText">{msg}</div>}
   </section>

   <section className="statsV2 v5stats"><article><span>분석 완료</span><b>{rows.filter(x=>x.dataStatus==='ok').length}</b><small>종목</small></article><article><span>아직 미급등</span><b>{eligible}</b><small>후보</small></article><article><span>70점 이상</span><b>{high}</b><small>선행 후보</small></article><article><span>추격 제외</span><b>{excluded}</b><small>종목</small></article></section>

   <section className="resultPanel"><div className="sectionTitle"><div><h2>V5 사전탐지 결과</h2><p>점수가 높을수록 여러 전조가 동시에 겹친 상태입니다. 상승확률이나 매수추천 점수가 아닙니다.</p></div><span>{filtered.length}종목</span></div>
    <input className="resultSearch" value={query} onChange={e=>setQuery(e.target.value)} placeholder="종목명·코드 검색"/>
    {!filtered.length?<div className="empty">검색을 실행하면 아직 크게 오르지 않았는데 과거 급등 전 모습과 닮아가는 종목부터 표시됩니다.</div>:<div className="v5results">{filtered.map((r,i)=><article className="v5row" key={`${r.market}-${r.code}`} onClick={()=>openDetail(r)}>
      <div className="v2rank">{i+1}</div><div className="v5name"><b>{r.name}</b><small>{r.market} · {r.code}</small><em>{r.preSpikeEligible?'미급등 후보':'가격 반영'} · 상세 ↗</em></div>
      <div className="v5metric"><span>전조점수</span><strong>{fmt(r.radarScore,1)}</strong><small>{r.stage}</small></div>
      <div className="v5metric"><span>당일 / 5일</span><strong className={(r.changePct||0)>=5?'hot':''}>{pct(r.changePct)}</strong><small>{pct(r.ret5)}</small></div>
      <div className="v5metric"><span>거래량</span><strong>{fmt(r.volumeRatio,2)}배</strong><small>선행 {fmt(r.volumeEarly,1)}/20</small></div>
      <div className="v5metric"><span>과거 유사도</span><strong>{fmt(r.historySimilarityPct,0)}%</strong><small>급등이력 {r.spikeCount||0}회</small></div>
      <div className="v5metric risk"><span>Fakeout 위험</span><strong>{fmt(r.fakeoutRisk,0)}</strong><small>낮을수록 양호</small></div>
    </article>)}</div>}
   </section>

   {selected&&<Detail row={selected} bars={bars} close={()=>setSelected(null)}/>}<footer>V5는 과거 패턴 유사도와 현재 이상징후를 비교하는 연구용 레이더입니다. 미래 수익을 보장하거나 예측 확률을 의미하지 않습니다.</footer>
 </main>;
}

function Range({title,value,min,max,suffix,onChange}:{title:string;value:number;min:number;max:number;suffix:string;onChange:(n:number)=>void}){
 return <div className="rangeRow"><div><b>{title}</b><strong>{value}{suffix}</strong></div><input type="range" min={min} max={max} value={value} onChange={e=>onChange(Number(e.target.value))}/></div>;
}

function Detail({row,bars,close}:{row:Row;bars:any[];close:()=>void}){
 const comps:[string,any,number][]=[['거래량 선행',row.volumeEarly,20],['가격 미반영',row.quietPrice,10],['이평 구조',row.maStructure,10],['20·60 수렴',row.convergence,8],['모멘텀',row.momentum,7],['과거 급등 유사',row.historySimilarity,15],['뉴스 증가',row.newsVelocityScore,8],['새 키워드',row.keywordNoveltyScore,7],['외국인·기관 수급',row.flowScore,5],['뉴스 출처 다양성',row.sourceDiversityScore,5],['테마 확인',row.themeConfirmationScore,5]];
 return <div className="modalBack" onClick={close}><section className="detailModal v5modal" onClick={e=>e.stopPropagation()}><button className="modalClose" onClick={close}>닫기 ✕</button>
   <div className="detailHead"><div><small>{row.market} · {row.code}</small><h2>{row.name}</h2><p>{pct(row.changePct)} · 5일 {pct(row.ret5)} · 거래량 {fmt(row.volumeRatio,2)}배 · RSI {fmt(row.rsi,1)}</p></div><div className="bigScore"><span>V5 전조점수</span><b>{fmt(row.radarScore,1)}</b><small>{row.stage} · 커버리지 {row.coverage||0}/100</small></div></div>
   <PriceChart bars={bars} marks={(row.spikeDates||[]).map(x=>x.date)}/>
   <div className="detailGrid"><div><h3>점수 구성</h3><div className="componentList">{comps.map(([n,v,m])=><div key={n}><span>{n}</span><i><em style={{width:`${typeof v==='number'?Math.min(100,v/m*100):0}%`}}/></i><b>{typeof v==='number'?`${fmt(v,1)}/${m}`:'데이터 없음'}</b></div>)}</div></div>
   <div><h3>핵심 상태</h3><ul className="reasonList"><li>미급등 판정: <b>{row.preSpikeEligible?'예 · 선행 후보':'아니오 · 가격 반영 구간'}</b></li><li>과거 패턴 유사도: <b>{fmt(row.historySimilarityPct,0)}%</b></li><li>Fakeout 위험: <b>{fmt(row.fakeoutRisk,0)}/100</b></li><li>가격 반영 감점: <b>{fmt(row.runPenalty,0)}</b></li><li>20·60일선 간격: <b>{fmt(row.maGap,2)}%</b></li></ul></div></div>
   <div className="detailGrid"><div><h3>포착 이유</h3><ul className="reasonList">{[...(row.reasons||[]),...(row.newsReasons||[]),...(row.flowReasons||[])].slice(0,16).map((x,i)=><li key={i}>{x}</li>)}</ul></div><div><h3>과거 급등 날짜</h3><div className="spikeChips">{(row.spikeDates||[]).length?(row.spikeDates||[]).slice().reverse().map(x=><span key={x.date}>{x.date} · +{x.pct.toFixed(1)}%</span>):<small>설정 기간 내 급등 이력 없음</small>}</div>{(row.keywords||[]).length>0&&<><h3>새로 포착된 키워드</h3><div className="spikeChips">{row.keywords!.map(x=><span key={x}>{x}</span>)}</div></>}</div></div>
   <h3>최근 뉴스</h3><div className="newsList">{(row.news||[]).length?(row.news||[]).map((n:any,i:number)=><a key={i} href={n.link} target="_blank" rel="noreferrer"><b>{n.title}</b><small>{n.date?.slice(0,10)} · {n.source||''}</small></a>):<div className="empty small">뉴스 데이터 없음</div>}</div>
 </section></div>;
}
