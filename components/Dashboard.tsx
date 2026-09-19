'use client';

import {useEffect,useMemo,useState} from 'react';
import * as XLSX from 'xlsx';
import styles from './V6Dashboard.module.css';

type Stock={name:string;code:string;market:'KOSPI'|'KOSDAQ';currentPrice:number|null;changePct:number|null;marketCap:number|null;sector:string|null;theme:string|null};
type Flow={date:string;inst:number;foreign:number};
type Row=Stock&{
  ret5?:number;
  absorptionScore?:number;
  trendScore?:number;
  stealthScore?:number;
  technicalScore?:number;
  flowScore?:number|null;
  penalty?:number;
  volumeRatio?:number;
  reasons?:string[];
  flowReasons?:string[];
  flow?:Flow[];
  finalScore?:number;
  stage?:string;
  coverage?:number;
  dataStatus?:string;
  error?:string;
  detectedAt?:string;
};
type Tab='top'|'all'|'55'|'70'|'settings';

const fmt=(n:any,d=0)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:d}):'-';
const pct=(n:any)=>typeof n==='number'&&Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(2)}%`:'-';

function stage(score:number){
  return score>=85?'강한 매집':score>=70?'매집 집중':score>=55?'매집 의심':score>=40?'관심':'관찰';
}

function calc(r:Row):Row{
  const tech=Number(r.technicalScore||0);
  const flow=typeof r.flowScore==='number'?r.flowScore:0;
  const penalty=Number(r.penalty||0);
  const final=Math.max(0,Math.min(100,tech+flow+penalty));
  return {...r,finalScore:Math.round(final*10)/10,stage:stage(final),coverage:typeof r.flowScore==='number'?100:65};
}

export default function Dashboard(){
  const [tab,setTab]=useState<Tab>('top');
  const [universe,setUniverse]=useState<Stock[]>([]);
  const [rows,setRows]=useState<Row[]>([]);
  const [query,setQuery]=useState('');
  const [busy,setBusy]=useState(false);
  const [period,setPeriod]=useState(120);
  const [msg,setMsg]=useState('');
  const [progress,setProgress]=useState({done:0,total:800,phase:'대기'});
  const [expanded,setExpanded]=useState<string|null>(null);

  useEffect(()=>{
    try{
      const r=localStorage.getItem('inst_acc_v6_latest');
      if(r)setRows(JSON.parse(r));
      const u=localStorage.getItem('inst_acc_v6_universe');
      if(u){const x=JSON.parse(u);if(Date.now()-x.ts<6*3600000)setUniverse(x.stocks||[]);}
    }catch{}
  },[]);

  async function checkedFetch(url:string,init?:RequestInit){
    const r=await fetch(url,init);
    if(r.status===401){location.href='/login';throw new Error('로그인이 필요합니다.');}
    return r;
  }

  async function loadUniverse(force=false){
    if(universe.length&&!force)return universe;
    setMsg('네이버 금융에서 KOSPI 500 + KOSDAQ 300 종목목록을 수집하고 있습니다.');
    const r=await checkedFetch('/api/universe');
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||'종목목록 수집 실패');
    const stocks=(j.stocks||[]) as Stock[];
    setUniverse(stocks);
    localStorage.setItem('inst_acc_v6_universe',JSON.stringify({ts:Date.now(),stocks}));
    setMsg(`종목목록 ${stocks.length}개 수집 완료`);
    return stocks;
  }

  async function scan(){
    setBusy(true);setRows([]);setExpanded(null);
    try{
      const stocks=await loadUniverse();
      if(!stocks.length)throw new Error('분석할 종목이 없습니다.');
      setProgress({done:0,total:stocks.length,phase:'가격·거래량 1차 분석'});
      let all:Row[]=[];

      for(let i=0;i<stocks.length;i+=12){
        const batch=stocks.slice(i,i+12);
        const r=await checkedFetch('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stocks:batch,period})});
        const j=await r.json();
        if(!r.ok)throw new Error(j.error||'분석 API 실패');
        all=[...all,...(j.results||[]).map((x:Row)=>calc(x))];
        all.sort((a,b)=>(b.finalScore||0)-(a.finalScore||0));
        setRows([...all]);
        setProgress({done:Math.min(i+batch.length,stocks.length),total:stocks.length,phase:'가격·거래량 1차 분석'});
        setMsg(`${Math.min(i+batch.length,stocks.length)} / ${stocks.length} 종목 1차 분석 완료`);
      }

      const candidates=all.filter(x=>x.dataStatus==='ok').sort((a,b)=>(b.technicalScore||0)+(b.penalty||0)-((a.technicalScore||0)+(a.penalty||0))).slice(0,500);
      setProgress({done:0,total:candidates.length,phase:'기관·외국인 수급 정밀분석'});
      setMsg(`상위 ${candidates.length}종목의 기관·외국인 10거래일 수급을 정밀분석합니다.`);

      for(let i=0;i<candidates.length;i+=20){
        const pack=candidates.slice(i,i+20);
        const r=await checkedFetch('/api/enrich',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stocks:pack})});
        if(r.ok){
          const j=await r.json();
          const map=new Map<string,any>((j.results||[]).map((x:any)=>[x.code,x]));
          all=all.map(x=>{const e=map.get(x.code);return e?calc({...x,...e}):x;});
          all.sort((a,b)=>(b.finalScore||0)-(a.finalScore||0));
          setRows([...all]);
        }
        setProgress({done:Math.min(i+pack.length,candidates.length),total:candidates.length,phase:'기관·외국인 수급 정밀분석'});
      }

      all.sort((a,b)=>(b.finalScore||0)-(a.finalScore||0));
      setRows(all);
      try{localStorage.setItem('inst_acc_v6_latest',JSON.stringify(all.slice(0,250)));}catch{}
      setMsg(`V6 분석 완료 · 전체 ${stocks.length}종목 중 기관·외국인 초기매집 점수 TOP100을 표시합니다.`);
    }catch(e){
      setMsg(e instanceof Error?e.message:'분석 실패');
    }finally{setBusy(false);}
  }

  async function logout(){await fetch('/api/auth/logout',{method:'POST'});location.href='/login';}

  const sorted=useMemo(()=>[...rows].filter(r=>r.dataStatus==='ok').sort((a,b)=>(b.finalScore||0)-(a.finalScore||0)),[rows]);
  const filtered=useMemo(()=>{
    let a=sorted.filter(r=>!query||r.name.includes(query)||r.code.includes(query));
    if(tab==='top')return a.slice(0,100);
    if(tab==='55')return a.filter(r=>(r.finalScore||0)>=55);
    if(tab==='70')return a.filter(r=>(r.finalScore||0)>=70);
    return a;
  },[sorted,query,tab]);
  const top100=useMemo(()=>sorted.slice(0,100),[sorted]);

  function exportXlsx(){
    const src=tab==='top'?top100:filtered;
    const data=src.map((r,i)=>({
      순위:i+1,종목명:r.name,종목코드:r.code,시장:r.market,현재가:r.currentPrice,당일등락률:r.changePct,최근5일:r.ret5,
      최종점수:r.finalScore,기관외국인수급점수:r.flowScore,물량흡수점수:r.absorptionScore,저점추세점수:r.trendScore,조용한매집점수:r.stealthScore,
      기술점수:r.technicalScore,과열감점:r.penalty,거래량배수:r.volumeRatio,데이터커버리지:`${r.coverage||0}%`,단계:r.stage,
      포착이유:[...(r.flowReasons||[]),...(r.reasons||[])].join(' | '),탐지일:r.detectedAt?.slice(0,10)||''
    }));
    const ws=XLSX.utils.json_to_sheet(data);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'기관외국인매집Top100');
    XLSX.writeFile(wb,`기관외국인_초기매집레이더_V6_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  const avgTop=top100.length?top100.reduce((a,b)=>a+(b.finalScore||0),0)/top100.length:0;
  const strong=top100.filter(x=>(x.finalScore||0)>=70).length;
  const dual=top100.filter(x=>(x.flowReasons||[]).some(v=>v.includes('동시 순매수'))).length;
  const pctProgress=progress.total?Math.min(100,progress.done/progress.total*100):0;

  return <main className={styles.wrap}>
    <header className={styles.hero}>
      <div>
        <div className={styles.eyebrow}>KOREA INSTITUTIONAL ACCUMULATION RADAR V6</div>
        <h1>기관·외국인 초기매집 레이더 V6</h1>
        <p>KOSPI 500 + KOSDAQ 300에서 급등 전 매집 가능성이 높은 종목을 Top 100으로 추립니다.</p>
        <div className={styles.note}>수급 35점 · 물량흡수 30점 · 저점/추세 25점 · 조용한 매집 10점 · 이미 급등한 종목 감점</div>
      </div>
      <button className={styles.logout} onClick={logout}>로그아웃</button>
    </header>

    <div className={styles.tabs}>
      {([['top','오늘의 TOP100'],['all','전체 결과'],['55','55점 이상'],['70','70점 이상'],['settings','설정']] as [Tab,string][]).map(([k,v])=><button key={k} className={`${styles.tab} ${tab===k?styles.active:''}`} onClick={()=>setTab(k)}>{v}</button>)}
    </div>

    <section className={styles.toolbar}>
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="종목명 또는 종목코드 검색"/>
      <button className={styles.primary} onClick={scan} disabled={busy}>{busy?'분석 중…':'800종목 분석 시작'}</button>
      <button className={styles.button} onClick={()=>loadUniverse(true)} disabled={busy}>종목목록 새로고침</button>
      <button className={styles.button} onClick={exportXlsx} disabled={!rows.length}>Excel .xlsx</button>
    </section>

    {(busy||progress.done>0)&&<>
      <div className={styles.status}><b>{progress.phase}</b> · {progress.done} / {progress.total}</div>
      <div className={styles.progress}><i style={{width:`${pctProgress}%`}}/></div>
    </>}
    {msg&&<div className={styles.status}>{msg}</div>}

    {tab==='settings'?<section className={styles.settings}>
      <h2>V6 분석 설정</h2>
      <label>가격·거래량 분석기간
        <select value={period} onChange={e=>setPeriod(Number(e.target.value))} disabled={busy}>
          <option value={60}>60거래일</option><option value={90}>90거래일</option><option value={120}>120거래일</option><option value={180}>180거래일</option>
        </select>
      </label>
      <p className={styles.note}>최종 Top100 정확도를 높이기 위해 기술점수 상위 500종목에 대해 기관·외국인 10거래일 수급을 추가 확인합니다.</p>
    </section>:<>
      <section className={styles.summary}>
        <div className={styles.metric}><span>Top100 평균점수</span><b>{fmt(avgTop,1)}</b></div>
        <div className={styles.metric}><span>70점 이상</span><b>{strong}종목</b></div>
        <div className={styles.metric}><span>기관·외국인 동시매수</span><b>{dual}종목</b></div>
        <div className={styles.metric}><span>분석 성공</span><b>{sorted.length}종목</b></div>
      </section>
      <section>
        <div className={styles.sectionHead}><h2>{tab==='top'?'기관·외국인 초기매집 TOP 100':tab==='all'?'전체 분석 결과':`${tab}점 이상`}</h2><span>{filtered.length}종목</span></div>
        {!filtered.length?<div className={styles.empty}>아직 분석 결과가 없습니다. “800종목 분석 시작”을 눌러주세요.</div>:<div className={styles.cards}>
          {filtered.map((r,i)=>{
            const key=`${r.market}-${r.code}`; const open=expanded===key;
            return <article className={styles.card} key={key} onClick={()=>setExpanded(open?null:key)}>
              <div className={styles.rank}>#{i+1}</div>
              <div className={styles.topline}>
                <div className={styles.name}><b>{r.name}</b><span>{r.code} · {r.market}</span></div>
                <div className={styles.price}><b>{fmt(r.currentPrice)}</b><span className={(r.changePct||0)>=0?styles.up:styles.down}>{pct(r.changePct)}</span></div>
              </div>
              <div className={styles.scoreRow}><div className={styles.scoreBig}>{fmt(r.finalScore,1)}<small>/100</small></div><div className={styles.stage}>{r.stage} · 데이터 {r.coverage||0}%</div></div>
              <div className={styles.grid}>
                <div className={styles.pill}><span>기관·외국인 수급</span><b>{fmt(r.flowScore,0)}/35</b></div>
                <div className={styles.pill}><span>물량흡수</span><b>{fmt(r.absorptionScore,0)}/30</b></div>
                <div className={styles.pill}><span>저점·추세</span><b>{fmt(r.trendScore,0)}/25</b></div>
                <div className={styles.pill}><span>조용한 매집</span><b>{fmt(r.stealthScore,0)}/10</b></div>
                <div className={styles.pill}><span>거래량 배수</span><b>{fmt(r.volumeRatio,1)}배</b></div>
                <div className={styles.pill}><span>최근 5일</span><b>{pct(r.ret5)}</b></div>
                <div className={styles.pill}><span>과열 감점</span><b>{fmt(r.penalty,0)}</b></div>
                <div className={styles.pill}><span>기술 점수</span><b>{fmt(r.technicalScore,0)}/65</b></div>
              </div>
              {open&&<div className={styles.reasons}>
                <b>포착 이유</b>
                {[...(r.flowReasons||[]),...(r.reasons||[])].slice(0,14).map((x,n)=><div key={n}>• {x}</div>)}
                {!!r.flow?.length&&<table className={styles.flowTable}><thead><tr><th>일자</th><th>기관</th><th>외국인</th></tr></thead><tbody>{r.flow.slice(0,10).map((x,n)=><tr key={n}><td>{x.date}</td><td>{fmt(x.inst)}</td><td>{fmt(x.foreign)}</td></tr>)}</tbody></table>}
              </div>}
            </article>;
          })}
        </div>}
      </section>
    </>}
    <footer className={styles.footer}>V6 점수는 상승 확률이나 매수 추천이 아니라 공개 가격·거래량·기관/외국인 수급에서 초기 매집과 유사한 패턴을 찾는 탐지 지표입니다.</footer>
  </main>;
}
