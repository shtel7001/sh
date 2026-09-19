'use client';

import { useMemo, useRef, useState } from 'react';
import styles from './InstitutionRadar.module.css';

type Row = {
  market:string; code:string; name:string; price:number; score:number; stage:string;
  inst5:number; foreign5:number; inst20:number; foreign20:number;
  combinedIntensity:number; price20:number; buyDays:number; bothDays:number; absorption:number;
  reason:string; days:number; source:string;
};

type Scope = 'both'|'kospi'|'kosdaq';

function fmtNum(v:number){ return new Intl.NumberFormat('ko-KR').format(Math.round(v || 0)); }
function fmtSigned(v:number){ return `${v>0?'+':''}${fmtNum(v)}`; }
function fmtPct(v:number){ return `${v>0?'+':''}${Number(v||0).toFixed(1)}%`; }
function scoreClass(score:number){ return score>=75?styles.scoreHot:score>=60?styles.scoreGood:score>=45?styles.scoreWatch:styles.scoreLow; }

export default function InstitutionRadar(){
  const [scope,setScope]=useState<Scope>('both');
  const [rows,setRows]=useState<Row[]>([]);
  const [running,setRunning]=useState(false);
  const [done,setDone]=useState(0);
  const [total,setTotal]=useState(16);
  const [msg,setMsg]=useState('대기 중');
  const [minScore,setMinScore]=useState(0);
  const [query,setQuery]=useState('');
  const abortRef=useRef(false);

  const filtered=useMemo(()=>rows.filter(r=>r.score>=minScore && (!query || `${r.name} ${r.code}`.toLowerCase().includes(query.toLowerCase()))),[rows,minScore,query]);
  const top=useMemo(()=>filtered.slice(0,100),[filtered]);
  const strong=rows.filter(r=>r.score>=75).length;
  const early=rows.filter(r=>r.score>=60).length;

  async function fetchTask(market:'kospi'|'kosdaq',page:number){
    const res=await fetch(`/api/institution-scan?market=${market}&page=${page}`,{cache:'no-store'});
    if(res.status===401){ location.href='/login'; throw new Error('인증 필요'); }
    const data=await res.json();
    if(!res.ok) throw new Error(data?.error||'수집 오류');
    return data.rows as Row[];
  }

  async function scan(){
    if(running) return;
    abortRef.current=false;
    setRunning(true); setRows([]); setDone(0);
    const tasks:{market:'kospi'|'kosdaq';page:number}[]=[];
    if(scope==='both'||scope==='kospi') for(let p=1;p<=10;p++) tasks.push({market:'kospi',page:p});
    if(scope==='both'||scope==='kosdaq') for(let p=1;p<=6;p++) tasks.push({market:'kosdaq',page:p});
    setTotal(tasks.length); setMsg('네이버 금융에서 시총 상위 종목과 투자자별 매매동향을 수집하고 있습니다.');
    const merged:Row[]=[];
    try{
      for(let i=0;i<tasks.length;i+=2){
        if(abortRef.current) break;
        const batch=tasks.slice(i,i+2);
        const got=await Promise.all(batch.map(t=>fetchTask(t.market,t.page).catch(()=>[])));
        got.flat().forEach(r=>merged.push(r));
        merged.sort((a,b)=>b.score-a.score || b.combinedIntensity-a.combinedIntensity);
        setRows([...merged]); setDone(Math.min(i+batch.length,tasks.length));
        setMsg(`분석 ${Math.min((i+batch.length)*50, scope==='both'?800:scope==='kospi'?500:300)}종목 수준 진행 · 현재 후보 ${merged.length}개`);
      }
      setMsg(abortRef.current?'사용자 중지':'분석 완료 · 매집 초기 점수순 Top 100');
    }catch(e:any){ setMsg(`오류: ${e?.message||'수집 실패'}`); }
    finally{ setRunning(false); }
  }

  function stop(){ abortRef.current=true; setMsg('현재 묶음까지만 처리 후 중지합니다.'); }

  function csv(){
    const header=['순위','시장','종목명','코드','현재가','점수','단계','기관5일','외국인5일','기관20일','외국인20일','20일주가%','수급강도%','10일수급우위일','흡수매수일','포착이유'];
    const body=top.map((r,i)=>[i+1,r.market,r.name,r.code,r.price,r.score,r.stage,r.inst5,r.foreign5,r.inst20,r.foreign20,r.price20,r.combinedIntensity,r.buyDays,r.absorption,r.reason]);
    const text='\ufeff'+[header,...body].map(a=>a.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');
    const blob=new Blob([text],{type:'text/csv;charset=utf-8'}); const u=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=u; a.download=`기관외국인_매집초기_TOP100_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(u);
  }

  return <main className={styles.page}>
    <section className={styles.hero}>
      <div>
        <div className={styles.eyebrow}>INSTITUTION · FOREIGN ACCUMULATION RADAR</div>
        <h1>기관·외국인 매집 초기 레이더</h1>
        <p>이미 많이 오른 종목보다 <b>기관·외국인 수급이 먼저 들어오는데 주가는 아직 과열되지 않은 종목</b>을 찾습니다.</p>
      </div>
      <div className={styles.badge}>V2 구조 · TOP 100</div>
    </section>

    <section className={styles.scoreGrid}>
      <div><b>20점</b><span>외국인 20일 매수강도</span></div>
      <div><b>20점</b><span>기관 20일 매수강도</span></div>
      <div><b>20점</b><span>주가 과열 전 구간</span></div>
      <div><b>10점</b><span>기관·외국인 동시매수</span></div>
      <div><b>10점</b><span>최근 10일 연속성</span></div>
      <div><b>10점</b><span>최근 5일 매수 가속</span></div>
      <div><b>10점</b><span>하락일 흡수매수</span></div>
    </section>

    <section className={styles.controls}>
      <div className={styles.segment}>
        {(['both','kospi','kosdaq'] as Scope[]).map(v=><button key={v} className={scope===v?styles.active:''} onClick={()=>setScope(v)} disabled={running}>{v==='both'?'KOSPI 500 + KOSDAQ 300':v==='kospi'?'KOSPI 500':'KOSDAQ 300'}</button>)}
      </div>
      <div className={styles.actions}>
        <button className={styles.primary} onClick={scan} disabled={running}>{running?'분석 중…':'전체 분석 시작'}</button>
        {running && <button className={styles.stop} onClick={stop}>중지</button>}
        <button className={styles.secondary} onClick={csv} disabled={!top.length}>CSV 저장</button>
      </div>
      <div className={styles.progressWrap}>
        <div className={styles.progress}><i style={{width:`${total?done/total*100:0}%`}}/></div>
        <span>{done}/{total} 묶음 · {msg}</span>
      </div>
    </section>

    <section className={styles.stats}>
      <div><span>분석된 후보</span><b>{fmtNum(rows.length)}</b></div>
      <div><span>75점 이상</span><b>{fmtNum(strong)}</b></div>
      <div><span>60점 이상</span><b>{fmtNum(early)}</b></div>
      <div><span>화면 표시</span><b>{fmtNum(top.length)} / 100</b></div>
    </section>

    <section className={styles.filterbar}>
      <label>최소 점수 <b>{minScore}</b><input type="range" min="0" max="90" step="5" value={minScore} onChange={e=>setMinScore(Number(e.target.value))}/></label>
      <input placeholder="종목명·코드 검색" value={query} onChange={e=>setQuery(e.target.value)}/>
    </section>

    <section className={styles.tableCard}>
      <div className={styles.tableHead}><h2>매집 초기 후보 TOP 100</h2><span>점수는 매수 추천이 아니라 수급 구조 탐지용입니다.</span></div>
      <div className={styles.tableScroll}>
        <table>
          <thead><tr><th>#</th><th>종목</th><th>점수</th><th>단계</th><th>현재가</th><th>20일 주가</th><th>기관 5일</th><th>외국인 5일</th><th>기관 20일</th><th>외국인 20일</th><th>수급강도</th><th>10일 우위</th><th>포착 이유</th></tr></thead>
          <tbody>
            {top.map((r,i)=><tr key={`${r.market}-${r.code}`}>
              <td className={styles.rank}>{i+1}</td>
              <td><a href={r.source} target="_blank" rel="noreferrer"><b>{r.name}</b><small>{r.market} · {r.code}</small></a></td>
              <td><span className={`${styles.score} ${scoreClass(r.score)}`}>{r.score}</span></td>
              <td><span className={styles.stage}>{r.stage}</span></td>
              <td className={styles.num}>{fmtNum(r.price)}</td>
              <td className={`${styles.num} ${r.price20>0?styles.up:r.price20<0?styles.down:''}`}>{fmtPct(r.price20)}</td>
              <td className={`${styles.num} ${r.inst5>0?styles.up:styles.down}`}>{fmtSigned(r.inst5)}</td>
              <td className={`${styles.num} ${r.foreign5>0?styles.up:styles.down}`}>{fmtSigned(r.foreign5)}</td>
              <td className={`${styles.num} ${r.inst20>0?styles.up:styles.down}`}>{fmtSigned(r.inst20)}</td>
              <td className={`${styles.num} ${r.foreign20>0?styles.up:styles.down}`}>{fmtSigned(r.foreign20)}</td>
              <td className={styles.num}>{r.combinedIntensity.toFixed(2)}%</td>
              <td className={styles.num}>{r.buyDays}/10</td>
              <td className={styles.reason}>{r.reason||'수급 변화 관찰'}</td>
            </tr>)}
            {!top.length && <tr><td colSpan={13} className={styles.empty}>‘전체 분석 시작’을 누르면 결과가 여기에 최대 100종목까지 표시됩니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>

    <footer className={styles.footer}>데이터: 네이버 금융/KRX 제공 투자자별 매매동향 · 페이지 특성상 약 20분 지연 또는 장마감 기준 데이터가 포함될 수 있습니다. 단순 순매수 추종이 아니라 가격과 수급의 괴리를 점수화합니다.</footer>
  </main>;
}
