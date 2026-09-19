'use client';

import { useMemo, useRef, useState } from 'react';
import styles from './InstitutionRadar.module.css';

type Spike={date:string;rate:number;close:number};
type Row={
  market:'KOSPI'|'KOSDAQ'; code:string; name:string; price:number; score:number; stage:string;
  inst5:number; foreign5:number; inst20:number; foreign20:number;
  combinedIntensity:number; price20:number; buyDays:number; bothDays:number; absorption:number;
  reason:string; days:number; source:string; flowSource?:string;
  spikes?:Spike[]; tradingDays?:number; spikeSource?:string; spikeError?:string|null;
};
type Scope='both'|'kospi'|'kosdaq';

function fmtNum(v:number){return new Intl.NumberFormat('ko-KR').format(Math.round(v||0));}
function fmtSigned(v:number){return `${v>0?'+':''}${fmtNum(v)}`;}
function fmtPct(v:number){return `${v>0?'+':''}${Number(v||0).toFixed(1)}%`;}
function scoreClass(score:number){return score>=75?styles.scoreHot:score>=60?styles.scoreGood:score>=45?styles.scoreWatch:styles.scoreLow;}
function keyOf(r:{market:string;code:string}){return `${r.market}-${r.code}`;}
function todayKST(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}

export default function InstitutionRadar(){
  const [scope,setScope]=useState<Scope>('both');
  const [rows,setRows]=useState<Row[]>([]);
  const [running,setRunning]=useState(false);
  const [done,setDone]=useState(0);
  const [total,setTotal]=useState(16);
  const [msg,setMsg]=useState('대기 중');
  const [minScore,setMinScore]=useState(0);
  const [query,setQuery]=useState('');
  const [failedPages,setFailedPages]=useState(0);
  const [failedStocks,setFailedStocks]=useState(0);
  const [spikeDone,setSpikeDone]=useState(0);
  const abortRef=useRef(false);

  const rankedTop=useMemo(()=>rows.slice(0,100),[rows]);
  const top=useMemo(()=>rankedTop.filter(r=>r.score>=minScore&&(!query||`${r.name} ${r.code}`.toLowerCase().includes(query.toLowerCase()))),[rankedTop,minScore,query]);
  const strong=rows.filter(r=>r.score>=75).length;
  const early=rows.filter(r=>r.score>=60).length;

  async function fetchTask(market:'kospi'|'kosdaq',page:number){
    const res=await fetch(`/api/institution-scan?market=${market}&page=${page}`,{cache:'no-store'});
    if(res.status===401){location.href='/login';throw new Error('인증 필요');}
    const data=await res.json();
    if(!res.ok) throw new Error(data?.error||`${market} ${page}페이지 수집 오류`);
    return data as {rows:Row[];failed:number;success:number;universeSource:string};
  }

  async function enrichSpikes(base:Row[]){
    const target=base.slice(0,100);
    setSpikeDone(0);
    let current=[...base];
    for(let i=0;i<target.length;i+=20){
      if(abortRef.current) break;
      const chunk=target.slice(i,i+20);
      try{
        const res=await fetch('/api/spike-history',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items:chunk.map(r=>({code:r.code,market:r.market}))})});
        if(res.status===401){location.href='/login';throw new Error('인증 필요');}
        const data=await res.json();
        if(!res.ok) throw new Error(data?.error||'급등 이력 수집 오류');
        const map=new Map<string,any>();
        for(const h of data.rows||[]) map.set(`${h.market}-${h.code}`,h);
        current=current.map(r=>{
          const h=map.get(keyOf(r));
          return h?{...r,spikes:h.spikes||[],tradingDays:h.tradingDays||0,spikeSource:h.source,spikeError:h.error}:r;
        });
        setRows([...current]);
      }catch(e:any){
        current=current.map(r=>chunk.some(c=>keyOf(c)===keyOf(r))?{...r,spikes:[],tradingDays:0,spikeSource:'failed',spikeError:e?.message||'급등 이력 실패'}:r);
        setRows([...current]);
      }
      setSpikeDone(Math.min(i+chunk.length,target.length));
      setMsg(`Top 100의 최근 240거래일 +10% 급등 날짜 확인 중 · ${Math.min(i+chunk.length,target.length)}/${target.length}`);
    }
    return current;
  }

  async function scan(){
    if(running)return;
    abortRef.current=false; setRunning(true); setRows([]); setDone(0); setFailedPages(0); setFailedStocks(0); setSpikeDone(0);
    const tasks:{market:'kospi'|'kosdaq';page:number}[]=[];
    if(scope==='both'||scope==='kospi')for(let p=1;p<=10;p++)tasks.push({market:'kospi',page:p});
    if(scope==='both'||scope==='kosdaq')for(let p=1;p<=6;p++)tasks.push({market:'kosdaq',page:p});
    setTotal(tasks.length);
    setMsg('네이버 JSON 시총순위와 투자자별 수급을 수집하고 있습니다. 실패 시 PC 경로로 자동 대체합니다.');
    let merged:Row[]=[]; let pageFail=0; let stockFail=0;
    try{
      for(let i=0;i<tasks.length;i+=2){
        if(abortRef.current)break;
        const batch=tasks.slice(i,i+2);
        const settled=await Promise.allSettled(batch.map(t=>fetchTask(t.market,t.page)));
        for(const s of settled){
          if(s.status==='fulfilled'){
            merged.push(...s.value.rows); stockFail+=Number(s.value.failed||0);
          }else pageFail++;
        }
        const uniq=new Map<string,Row>(); for(const r of merged)uniq.set(keyOf(r),r);
        merged=[...uniq.values()].sort((a,b)=>b.score-a.score||b.combinedIntensity-a.combinedIntensity);
        setRows([...merged]); setDone(Math.min(i+batch.length,tasks.length)); setFailedPages(pageFail); setFailedStocks(stockFail);
        setMsg(`수급 분석 진행 · 정상 ${merged.length}종목 · 종목수집 실패 ${stockFail}건 · 페이지 실패 ${pageFail}건`);
      }
      if(!merged.length) throw new Error('수급 데이터가 한 종목도 생성되지 않았습니다. 데이터 소스 상태를 확인했습니다.');
      if(!abortRef.current){
        merged=await enrichSpikes(merged);
        const top100=merged.slice(0,100);
        const spikeFail=top100.filter(r=>r.spikeSource==='failed').length;
        setMsg(`완료 · 수급 후보 ${merged.length}종목 / Top 100 급등이력 ${top100.length-spikeFail}종목 확인 · 페이지 실패 ${pageFail}건`);
      }else setMsg('사용자 중지');
    }catch(e:any){setMsg(`오류: ${e?.message||'수집 실패'}`);}
    finally{setRunning(false);}
  }

  function stop(){abortRef.current=true;setMsg('현재 처리 중인 묶음까지만 완료하고 중지합니다.');}

  async function saveExcel(){
    if(!rankedTop.length)return;
    const XLSX=await import('xlsx');
    const main=rankedTop.map((r,i)=>({
      '순위':i+1,'시장':r.market,'종목명':r.name,'종목코드':r.code,'현재가':r.price,'매집점수':r.score,'단계':r.stage,
      '기관 5일 순매수':r.inst5,'외국인 5일 순매수':r.foreign5,'기관 누적 순매수':r.inst20,'외국인 누적 순매수':r.foreign20,
      '최근구간 주가변화(%)':r.price20,'수급강도(%)':r.combinedIntensity,'최근10일 수급우위일':r.buyDays,'하락일 흡수매수':r.absorption,
      '수급 데이터 거래일수':r.days,'240일 10%이상 급등 횟수':r.spikes?.length??'',
      '240일 10%이상 급등 날짜':r.spikes?.map(s=>`${s.date} (+${s.rate.toFixed(2)}%)`).join(' | ')??'확인 중',
      '급등이력 소스':r.spikeSource??'','포착 이유':r.reason,'수급 소스':r.flowSource??''
    }));
    const detail:any[]=[];
    rankedTop.forEach((r,i)=>{
      if(r.spikes?.length)r.spikes.forEach(s=>detail.push({'순위':i+1,'시장':r.market,'종목명':r.name,'종목코드':r.code,'급등일':s.date,'당일 상승률(%)':s.rate,'종가':s.close,'데이터 소스':r.spikeSource||''}));
      else detail.push({'순위':i+1,'시장':r.market,'종목명':r.name,'종목코드':r.code,'급등일':'해당 없음','당일 상승률(%)':'','종가':'','데이터 소스':r.spikeSource||''});
    });
    const wb=XLSX.utils.book_new();
    const ws1=XLSX.utils.json_to_sheet(main); const ws2=XLSX.utils.json_to_sheet(detail);
    ws1['!cols']=[{wch:7},{wch:9},{wch:22},{wch:10},{wch:13},{wch:10},{wch:14},{wch:16},{wch:16},{wch:18},{wch:18},{wch:18},{wch:14},{wch:18},{wch:16},{wch:17},{wch:18},{wch:65},{wch:20},{wch:70},{wch:18}];
    ws2['!cols']=[{wch:7},{wch:9},{wch:22},{wch:10},{wch:13},{wch:16},{wch:14},{wch:22}];
    XLSX.utils.book_append_sheet(wb,ws1,'매집초기_TOP100'); XLSX.utils.book_append_sheet(wb,ws2,'240일_10%급등일');
    XLSX.writeFile(wb,`기관외국인_매집초기_TOP100_${todayKST()}.xlsx`,{compression:true});
  }

  return <main className={styles.page}>
    <section className={styles.hero}><div><div className={styles.eyebrow}>INSTITUTION · FOREIGN ACCUMULATION RADAR</div><h1>기관·외국인 매집 초기 레이더</h1><p>기관·외국인 수급이 먼저 들어오는데 주가는 아직 과열되지 않은 종목을 찾고, <b>최근 240거래일 +10% 이상 급등일</b>까지 함께 확인합니다.</p></div><div className={styles.badge}>V2.1 · TOP 100</div></section>

    <section className={styles.scoreGrid}><div><b>20점</b><span>외국인 누적 매수강도</span></div><div><b>20점</b><span>기관 누적 매수강도</span></div><div><b>20점</b><span>주가 과열 전 구간</span></div><div><b>10점</b><span>기관·외국인 동시매수</span></div><div><b>10점</b><span>최근 10일 연속성</span></div><div><b>10점</b><span>최근 5일 매수 가속</span></div><div><b>10점</b><span>하락일 흡수매수</span></div></section>

    <section className={styles.controls}>
      <div className={styles.segment}>{(['both','kospi','kosdaq'] as Scope[]).map(v=><button key={v} className={scope===v?styles.active:''} onClick={()=>setScope(v)} disabled={running}>{v==='both'?'KOSPI 500 + KOSDAQ 300':v==='kospi'?'KOSPI 500':'KOSDAQ 300'}</button>)}</div>
      <div className={styles.actions}><button className={styles.primary} onClick={scan} disabled={running}>{running?'분석 중…':'전체 분석 시작'}</button>{running&&<button className={styles.stop} onClick={stop}>중지</button>}<button className={styles.secondary} onClick={saveExcel} disabled={!rankedTop.length}>Excel 최신버전(.xlsx) 저장</button></div>
      <div className={styles.progressWrap}><div className={styles.progress}><i style={{width:`${running&&done>=total&&rankedTop.length?Math.min(100,70+spikeDone/Math.max(1,rankedTop.length)*30):total?done/total*70:0}%`}}/></div><span>{done}/{total} 수급 묶음 · 급등이력 {spikeDone}/{rankedTop.length||100} · {msg}</span></div>
    </section>

    <section className={styles.stats}><div><span>정상 분석 종목</span><b>{fmtNum(rows.length)}</b></div><div><span>75점 이상</span><b>{fmtNum(strong)}</b></div><div><span>60점 이상</span><b>{fmtNum(early)}</b></div><div><span>수집 실패</span><b>{fmtNum(failedStocks+failedPages)}</b></div></section>

    <section className={styles.filterbar}><label>최소 점수 <b>{minScore}</b><input type="range" min="0" max="90" step="5" value={minScore} onChange={e=>setMinScore(Number(e.target.value))}/></label><input placeholder="Top 100 종목명·코드 검색" value={query} onChange={e=>setQuery(e.target.value)}/></section>

    <section className={styles.tableCard}><div className={styles.tableHead}><h2>매집 초기 후보 TOP 100</h2><span>점수는 수급 구조 탐지용이며 매수 추천이 아닙니다. +10% 급등은 전 거래일 종가 대비 기준입니다.</span></div><div className={styles.tableScroll}><table><thead><tr><th>#</th><th>종목</th><th>점수</th><th>단계</th><th>현재가</th><th>주가변화</th><th>기관 5일</th><th>외국인 5일</th><th>기관 누적</th><th>외국인 누적</th><th>수급강도</th><th>10일 우위</th><th>240일 +10% 급등일</th><th>포착 이유</th><th>수급일수</th></tr></thead><tbody>
      {top.map((r,i)=>{const globalRank=rankedTop.findIndex(x=>keyOf(x)===keyOf(r))+1;return <tr key={keyOf(r)}><td className={styles.rank}>{globalRank||i+1}</td><td><a href={r.source} target="_blank" rel="noreferrer"><b>{r.name}</b><small>{r.market} · {r.code}</small></a></td><td><span className={`${styles.score} ${scoreClass(r.score)}`}>{r.score}</span></td><td><span className={styles.stage}>{r.stage}</span></td><td className={styles.num}>{fmtNum(r.price)}</td><td className={`${styles.num} ${r.price20>0?styles.up:r.price20<0?styles.down:''}`}>{fmtPct(r.price20)}</td><td className={`${styles.num} ${r.inst5>0?styles.up:styles.down}`}>{fmtSigned(r.inst5)}</td><td className={`${styles.num} ${r.foreign5>0?styles.up:styles.down}`}>{fmtSigned(r.foreign5)}</td><td className={`${styles.num} ${r.inst20>0?styles.up:styles.down}`}>{fmtSigned(r.inst20)}</td><td className={`${styles.num} ${r.foreign20>0?styles.up:styles.down}`}>{fmtSigned(r.foreign20)}</td><td className={styles.num}>{r.combinedIntensity.toFixed(2)}%</td><td className={styles.num}>{r.buyDays}/10</td><td className={styles.spikes}>{r.spikes===undefined?'확인 중…':r.spikes.length?r.spikes.map(s=><span key={s.date}>{s.date} <b>+{s.rate.toFixed(1)}%</b></span>):'해당 없음'}<small>{r.spikeSource?` ${r.tradingDays||0}거래일 · ${r.spikeSource}`:''}</small></td><td className={styles.reason}>{r.reason||'수급 변화 관찰'}</td><td className={styles.num}>{r.days}</td></tr>})}
      {!top.length&&<tr><td colSpan={15} className={styles.empty}>‘전체 분석 시작’을 누르면 실제 수급을 분석해 Top 100을 표시합니다. 데이터 소스 실패가 생기면 진행 문구에 실패 건수도 함께 표시됩니다.</td></tr>}
    </tbody></table></div></section>

    <footer className={styles.footer}>수급: 네이버페이 증권 공개 투자자별 매매동향(JSON 우선, PC 화면 자동 대체) · 240거래일 급등이력: Yahoo Finance 우선, 네이버 일봉 자동 대체 · 급등일은 전 거래일 종가 대비 +10% 이상인 거래일을 모두 표시합니다.</footer>
  </main>;
}
