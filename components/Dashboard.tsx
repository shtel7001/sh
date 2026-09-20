'use client';
import {useEffect,useMemo,useState} from 'react';
import * as XLSX from 'xlsx';

type Hit={date:string;previousClose:number;close:number;risePct:number;volume:number};
type Stock={name:string;code:string;market:'KOSPI'|'KOSDAQ';rank?:number;currentPrice:number|null;changePct:number|null;marketCap:number|null;sector:string|null;theme:string|null};
type Row=Stock&{currentClose?:number;currentDate?:string;scannedDays?:number;hits:Hit[];hitCount:number;maxRisePct:number;latestHitDate?:string|null;matched:boolean;dataStatus:string;error?:string;themeSource?:string;infostockUrl?:string};
const fmt=(n:any)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('ko-KR'):'-';
const kst=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());
const ago=(days:number)=>{const d=new Date();d.setDate(d.getDate()-days);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(d)};
const nextDay=(s:string)=>{const d=new Date(`${s}T00:00:00+09:00`);d.setDate(d.getDate()+1);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(d)};
const naverDate=(s:string)=>s.replaceAll('-','.');
function links(name:string,code:string,date:string){
  const q=encodeURIComponent(`${name} ${date}`),qg=encodeURIComponent(`${name} after:${date} before:${nextDay(date)}`);
  return {stock:`https://finance.naver.com/item/news_news.naver?code=${code}&page=1&sm=title_entity_id.basic`,naver:`https://search.naver.com/search.naver?where=news&query=${q}&sort=0&pd=3&ds=${naverDate(date)}&de=${naverDate(date)}`,google:`https://news.google.com/search?q=${qg}&hl=ko&gl=KR&ceid=KR:ko`};
}

export default function Dashboard(){
  const [threshold,setThreshold]=useState(7),[period,setPeriod]=useState(60);
  const [startDate,setStartDate]=useState(()=>ago(110)),[endDate,setEndDate]=useState(()=>kst());
  const [universe,setUniverse]=useState<Stock[]>([]),[universeCount,setUniverseCount]=useState(0),[rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false),[status,setStatus]=useState('종목목록: 네이버 금융 · 과거 일봉: Yahoo Finance');
  const [progress,setProgress]=useState({done:0,total:0,ok:0,fail:0}),[sort,setSort]=useState<'rise'|'recent'|'hits'|'rank'>('rise'),[query,setQuery]=useState('');
  const [liveMode,setLiveMode]=useState(false),[quoteDate,setQuoteDate]=useState('');
  useEffect(()=>{try{const r=localStorage.getItem('kospi_all_spike_240_rows');if(r)setRows(JSON.parse(r));const u=localStorage.getItem('kospi_all_spike_240_universe');if(u){const x=JSON.parse(u);if(Date.now()-x.ts<3*3600000){setUniverse(x.stocks);setUniverseCount(x.stocks.length)}}}catch{}},[]);

  async function loadUniverse(){
    if(universe.length)return universe;
    setStatus('1/3 · 네이버 금융 KOSPI 전 종목 목록 수집 중…');
    const r=await fetch('/api/universe',{cache:'no-store'}),j=await r.json();if(!r.ok)throw new Error(j.error||'종목목록 수집 실패');
    const stocks=(j.stocks||[]) as Stock[];if(stocks.length<500)throw new Error(`KOSPI 종목이 ${stocks.length}개만 수집되어 중단했습니다.`);
    setUniverse(stocks);setUniverseCount(stocks.length);localStorage.setItem('kospi_all_spike_240_universe',JSON.stringify({ts:Date.now(),stocks}));return stocks;
  }
  function quick(n:number){setLiveMode(false);setPeriod(n);setEndDate(kst());setStartDate(ago(Math.ceil(n*1.55)+10));}
  async function enrich(found:Row[]){
    let out=[...found];
    for(let i=0;i<out.length;i+=25){
      const pack=out.slice(i,i+25);setStatus(`3/3 · 업종·인포스탁 테마 보강 ${Math.min(i+25,out.length)}/${out.length}`);
      try{
        const r=await fetch('/api/profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stocks:pack.map(x=>({code:x.code,name:x.name}))})});if(!r.ok)continue;
        const j=await r.json();const m=new Map((j.results||[]).map((x:any)=>[x.code,x]));
        out=out.map(x=>{const p:any=m.get(x.code);return p?{...x,sector:p.sector||x.sector,theme:p.theme||x.theme,themeSource:p.themeSource,infostockUrl:p.infostockUrl}:x});
      }catch{}
    }
    return out;
  }

  async function scanToday(){
    const today=kst();setStartDate(today);setEndDate(today);setPeriod(1);setLiveMode(true);setBusy(true);setRows([]);setProgress({done:0,total:0,ok:0,fail:0});setStatus('당일 실시간 · 네이버 금융 현재가 전 종목 조회 중…');
    try{
      const r=await fetch('/api/live',{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({threshold})});const j=await r.json();if(!r.ok)throw new Error(j.error||'당일 실시간 검색 실패');
      let found=(j.results||[]) as Row[];const count=Number(j.universeCount||0);setUniverseCount(count);setQuoteDate(j.quoteDate||today);setProgress({done:count,total:count,ok:count,fail:0});
      setRows([...found].sort((a,b)=>b.maxRisePct-a.maxRisePct));
      found=await enrich(found);found.sort((a,b)=>b.maxRisePct-a.maxRisePct);setRows(found);localStorage.setItem('kospi_all_spike_240_rows',JSON.stringify(found));
      setStatus(`완료 · 당일 현재가 기준 KOSPI ${count}종목 · +${threshold.toFixed(1)}% 이상 ${found.length}종목 · 기준일 ${j.quoteDate||today}`);
    }catch(e){setStatus(`오류 · ${e instanceof Error?e.message:'당일 실시간 검색 실패'}`);}finally{setBusy(false);}
  }

  async function scan(){
    if(startDate&&endDate&&startDate>endDate){setStatus('시작일이 종료일보다 늦습니다.');return;}
    setLiveMode(false);setQuoteDate('');setBusy(true);setRows([]);setProgress({done:0,total:0,ok:0,fail:0});
    try{
      const stocks=await loadUniverse();let found:Row[]=[];let done=0,ok=0,fail=0;setProgress({done:0,total:stocks.length,ok:0,fail:0});
      for(let i=0;i<stocks.length;i+=30){
        const batch=stocks.slice(i,i+30);setStatus(`2/3 · Yahoo Finance 분석 ${done}/${stocks.length} · 최대 ${period}거래일`);
        const r=await fetch('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stocks:batch,period,threshold,startDate,endDate})});const j=await r.json();if(!r.ok)throw new Error(j.error||'분석 API 실패');
        const rs=(j.results||[]) as Row[];done+=rs.length;ok+=rs.filter(x=>x.dataStatus==='ok').length;fail+=rs.filter(x=>x.dataStatus!=='ok').length;found.push(...rs.filter(x=>x.matched));
        setProgress({done,total:stocks.length,ok,fail});setRows([...found].sort((a,b)=>b.maxRisePct-a.maxRisePct));
      }
      found=await enrich(found);found.sort((a,b)=>b.maxRisePct-a.maxRisePct);setRows(found);localStorage.setItem('kospi_all_spike_240_rows',JSON.stringify(found));
      setStatus(`완료 · KOSPI ${stocks.length}종목 분석 · 조건 통과 ${found.length}종목 · 정상 ${ok} · 오류 ${fail}`);
    }catch(e){setStatus(`오류 · ${e instanceof Error?e.message:'분석 실패'}`);}finally{setBusy(false);}
  }
  async function logout(){await fetch('/api/auth/logout',{method:'POST'});location.href='/login'}
  const shown=useMemo(()=>{
    const a=rows.filter(x=>!query||x.name.includes(query)||x.code.includes(query)||String(x.sector||'').includes(query)||String(x.theme||'').includes(query));
    return [...a].sort((a,b)=>sort==='rank'?(a.rank||9999)-(b.rank||9999):sort==='hits'?b.hitCount-a.hitCount||b.maxRisePct-a.maxRisePct:sort==='recent'?String(b.latestHitDate||'').localeCompare(String(a.latestHitDate||''))||b.maxRisePct-a.maxRisePct:b.maxRisePct-a.maxRisePct);
  },[rows,query,sort]);
  function excel(){
    if(!rows.length)return;const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['KOSPI 전종목 급등 스캐너'],['검색일',kst()],['검색모드',liveMode?'당일 실시간':'과거 일봉'],['날짜범위',`${startDate} ~ ${endDate}`],['최대 거래일',period],['하루 상승률 기준(%)',threshold],['KOSPI 종목수',universeCount],['조건 통과',rows.length],['당일 현재가','네이버 금융'],['과거 일봉','Yahoo Finance'],['테마','인포스탁 우선 · 미확인 시 네이버 기업정보 보조']]),'요약');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows.map(x=>({시총순위:x.rank,종목명:x.name,종목코드:x.code,업종:x.sector,테마:x.theme,테마출처:x.themeSource,최근종가:x.currentClose,최근종가일:x.currentDate,최대상승률:x.maxRisePct,포착횟수:x.hitCount,최근급등일:x.latestHitDate,분석거래일:x.scannedDays,인포스탁:x.infostockUrl}))),'검색결과');
    const detail:any[]=[];rows.forEach(x=>x.hits.forEach(h=>{const l=links(x.name,x.code,h.date);detail.push({시총순위:x.rank,종목명:x.name,종목코드:x.code,업종:x.sector,테마:x.theme,테마출처:x.themeSource,급등일:h.date,전일종가:h.previousClose,당일종가:h.close,상승률:h.risePct,거래량:h.volume,네이버증권뉴스:l.stock,네이버뉴스:l.naver,구글뉴스:l.google,인포스탁:x.infostockUrl})}));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(detail),'급등상세');XLSX.writeFile(wb,`KOSPI_전종목_급등_${kst()}_${liveMode?'당일실시간':period+'일'}_${threshold}pct.xlsx`);
  }
  const pct=progress.total?Math.min(100,progress.done/progress.total*100):0;
  return <div className="ksapp"><header className="kstop"><div className="kslogo">KS</div><div><div className="kstitle">KOSPI 전종목 240일 급등 스캐너</div><div className="kssub">전 종목 · 당일 실시간 · 최대 240거래일</div></div><button className="logout" onClick={logout}>인증 해제</button></header>
    <main className="kswrap"><section className="kscard"><div className="eye">01 · 조건 설정</div><h1 className="hero">원하는 날짜에서<br/><em>하루 급등</em> 전부 찾기</h1><hr/>
      <div className="row"><span>하루 상승률 기준</span><b>{threshold.toFixed(1)}%</b></div><input className="slider" type="range" min="1" max="30" step="0.5" value={threshold} onChange={e=>setThreshold(Number(e.target.value))}/>
      <div className="num"><input type="number" min="1" max="30" step="0.5" value={threshold} onChange={e=>setThreshold(Math.max(1,Math.min(30,Number(e.target.value)||1)))}/><span>% 이상</span></div><hr/>
      <div className="row"><span>최대 검색 기간</span><b>{period}거래일</b></div><input className="slider" type="range" min="1" max="240" step="1" value={period} onChange={e=>{setLiveMode(false);setPeriod(Number(e.target.value))}}/>
      <div className="quick"><button className="today" onClick={scanToday} disabled={busy}>당일 실시간</button>{[7,30,60,120,180,240].map(x=><button key={x} className={!liveMode&&period===x?'on':''} onClick={()=>quick(x)} disabled={busy}>{x}일</button>)}</div>
      <div className="dates"><label>시작일<input type="date" value={startDate} onChange={e=>{setLiveMode(false);setStartDate(e.target.value)}}/></label><label>종료일<input type="date" value={endDate} max={kst()} onChange={e=>{setLiveMode(false);setEndDate(e.target.value)}}/></label></div>
      <div className="stats"><div><b>{period}</b><span>최대 거래일</span></div><div><b>{universeCount||'전체'}</b><span>KOSPI 종목</span></div><div><b>{liveMode?'LIVE':'1일'}</b><span>{liveMode?'당일 현재가':'급등 판정'}</span></div></div>
      <button className="go" onClick={scan} disabled={busy}>{busy?'검색 중…':'KOSPI 전종목 검색 →'}</button><div className="bar"><i style={{width:`${pct}%`}}/></div><div className="status">{status}</div>
      <p className="note"><b>당일 실시간</b>은 네이버 금융 현재가/등락률을 캐시 없이 다시 조회합니다. 과거 검색은 선택한 날짜 구간 안에서 최대 240거래일의 Yahoo 일봉을 분석합니다.</p>
    </section>
    <section className="kscard"><div className="head"><div><div className="eye">02 · 검색 결과</div><h2>{shown.length}개 종목 발견</h2><div className="cond">{liveMode?`당일 실시간 · 기준일 ${quoteDate||endDate}`:`${startDate} ~ ${endDate} · 최대 ${period}거래일`} · +{threshold.toFixed(1)}% 이상</div></div><div className="tools"><select value={sort} onChange={e=>setSort(e.target.value as any)}><option value="rise">최대 급등률순</option><option value="recent">최근 급등일순</option><option value="hits">포착횟수순</option><option value="rank">시총순위순</option></select><button onClick={excel} disabled={!rows.length}>엑셀 저장</button></div></div>
      <div className="diag"><div><b>{universeCount}</b><span>KOSPI 종목</span></div><div><b>{progress.ok}</b><span>{liveMode?'현재가 정상':'Yahoo 정상'}</span></div><div><b>{progress.fail}</b><span>데이터 오류</span></div></div>
      <input className="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="종목명 · 코드 · 업종 · 테마 검색"/>
      {!shown.length?<div className="empty">조건을 설정한 뒤 검색해 주세요.</div>:shown.map(x=><article className="result" key={x.code}><div className="r1"><div><div className="name">{x.name}</div><div className="code">{x.code} · 시총 {x.rank||'-'}위 · 최근종가 {fmt(x.currentClose)}원</div></div><div className="rise">+{x.maxRisePct.toFixed(2)}%</div></div>
        <div className="chips"><span>{x.hitCount}회 포착</span><span>최근 {x.latestHitDate||'-'}</span><span>{x.scannedDays||0}거래일 분석</span>{x.sector&&<span className="sector">업종 · {x.sector}</span>}{x.theme&&<span className="theme">테마 · {x.theme}</span>}{x.themeSource&&<span className="sourceChip">출처 · {x.themeSource}</span>}</div>
        {x.infostockUrl&&<div className="sourceLink"><a href={x.infostockUrl} target="_blank" rel="noreferrer">인포스탁 종목/테마 확인 ↗</a></div>}
        <div className="hits">{[...x.hits].reverse().map(h=>{const l=links(x.name,x.code,h.date);return <div className="hit" key={h.date}><div><b>{h.date}</b> · {fmt(h.previousClose)} → {fmt(h.close)}원 · <strong>+{h.risePct.toFixed(2)}%</strong> · 거래량 {fmt(h.volume)}</div><div className="news"><a href={l.stock} target="_blank" rel="noreferrer">네이버증권 뉴스</a><a href={l.naver} target="_blank" rel="noreferrer">네이버뉴스(당일)</a><a href={l.google} target="_blank" rel="noreferrer">구글뉴스(당일)</a></div></div>})}</div>
      </article>)}
    </section></main><style jsx global>{`
      html,body{color-scheme:light!important}.ksapp,.ksapp *{box-sizing:border-box}.ksapp{min-height:100vh;background:linear-gradient(#0b5a40 0 145px,#eff5f0 145px);font-family:system-ui,-apple-system,'Noto Sans KR',sans-serif;color:#111!important}.kstop{height:100px;position:sticky;top:0;z-index:20;background:#073b2bf2;color:#fff;display:flex;align-items:center;gap:16px;padding:16px 24px}.kslogo{width:62px;height:62px;border-radius:21px;background:#baff20;color:#111;display:grid;place-items:center;font-size:27px;font-weight:800}.kstitle{font-size:clamp(22px,4vw,32px);font-weight:850;color:#fff}.kssub{font-size:13px;color:#e7f4ed;margin-top:3px}.logout{margin-left:auto;border:1px solid #ffffff70;background:#ffffff18;color:#fff!important;border-radius:15px;padding:10px 13px}.kswrap{width:min(820px,calc(100% - 20px));margin:38px auto 70px}.kscard{background:#fff!important;color:#111!important;border:1px solid #0b5a3e1c;border-radius:34px;padding:clamp(22px,5vw,40px);margin-bottom:28px;box-shadow:0 15px 36px #063b2217}.eye{color:#333!important;font-size:18px;margin-bottom:22px}.hero{font-size:clamp(39px,8vw,58px);line-height:1.18;letter-spacing:-.055em;font-weight:500;margin:0 0 30px;color:#111!important}.hero em{font-style:normal;color:#0c714c}hr{border:0;border-top:1px solid #dfe6e1;margin:26px 0}.row{display:flex;justify-content:space-between;align-items:center;color:#333!important;font-size:20px}.row b{font-size:27px;color:#0a714b}.slider{width:100%;accent-color:#168157;margin:22px 0 15px}.num{height:80px;border:1.5px solid #bfc8c1;border-radius:24px;padding:0 20px;display:flex;align-items:center;background:#fff!important}.num input{border:0;outline:0;width:100%;font-size:39px;background:#fff!important;color:#111!important;-webkit-text-fill-color:#111!important}.num span{font-size:20px;color:#111!important}.quick{display:flex;gap:7px;flex-wrap:wrap;margin:16px 0}.quick button{border:1px solid #b8c4bc;background:#fff!important;color:#111!important;border-radius:12px;padding:10px 14px;font-weight:750}.quick button.on{background:#dfffb0!important;color:#111!important;border-color:#158157}.quick button.today{background:#baff20!important;color:#111!important;border-color:#82be00;font-weight:900}.quick button:disabled{opacity:.55}.dates{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}.dates label{font-size:14px;color:#222!important}.dates input{width:100%;height:52px;margin-top:6px;border:1px solid #bfc8c1;border-radius:15px;padding:0 13px;font-size:16px;background:#fff!important;color:#111!important;-webkit-text-fill-color:#111!important;color-scheme:light!important}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:30px 0}.stats div{border:1.5px solid #d2dbd5;border-radius:24px;padding:21px 15px;min-height:120px;background:#fff!important;color:#111!important}.stats b{display:block;font-size:32px;color:#0b714d}.stats span{font-size:13px;color:#222!important}.go{width:100%;border:1px solid #9acb00;border-radius:28px;background:#baff20!important;color:#111!important;padding:23px 16px;font-size:28px;font-weight:900;-webkit-text-fill-color:#111!important}.go:disabled{opacity:.55;color:#222!important;-webkit-text-fill-color:#222!important}.bar{height:9px;background:#e8eee9!important;border-radius:20px;overflow:hidden;margin-top:17px;padding:0!important;border:0!important}.bar i{display:block;height:100%;background:#178157!important;transition:.2s}.status{min-height:25px;margin-top:12px!important;color:#111!important;background:#f2f7f4!important;border:1px solid #d6e1da!important;border-radius:14px!important;padding:13px 15px!important;line-height:1.55!important}.note{color:#111!important;background:#f8faf9!important;border:1px solid #dbe4de!important;border-left:4px solid #168157!important;line-height:1.7;font-size:13px;padding:12px 14px!important;border-radius:10px!important}.note b{color:#0b714d}.head{display:flex;justify-content:space-between;gap:12px;align-items:end;flex-wrap:wrap}.head h2{font-size:31px;margin:0;color:#111!important}.cond{color:#111!important;font-weight:700;margin-top:6px}.tools{display:flex;gap:8px;flex-wrap:wrap}.tools select,.tools button{border:1px solid #bfc8c1;border-radius:14px;padding:11px;background:#fff!important;color:#111!important;-webkit-text-fill-color:#111!important}.tools button{background:#dfffb0!important;font-weight:800}.tools button:disabled{opacity:.4}.diag{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:18px 0}.diag div{background:#f3f8f4!important;color:#111!important;padding:12px;border-radius:16px}.diag b{display:block;font-size:23px;color:#111!important}.diag span{font-size:12px;color:#222!important}.search{width:100%;height:50px;border:1px solid #bfc8c1;border-radius:15px;padding:0 15px;margin:3px 0 7px;font-size:16px;background:#fff!important;color:#111!important;-webkit-text-fill-color:#111!important}.search::placeholder{color:#666!important}.result{border-top:1px solid #dfe6e1;padding:20px 0;color:#111!important}.r1{display:flex;justify-content:space-between;gap:12px}.name{font-size:22px;font-weight:850;color:#111!important}.code{font-size:13px;color:#333!important;margin-top:3px}.rise{font-size:26px;color:#c9342d!important;font-weight:900;white-space:nowrap}.chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}.chips span{background:#eef6f1!important;color:#111!important;padding:7px 9px;border-radius:999px;font-size:12px}.chips .sector{background:#eef2ff!important;color:#111!important}.chips .theme{background:#fff0c9!important;color:#111!important}.chips .sourceChip{background:#e5f7ff!important;color:#111!important}.sourceLink{margin-top:8px}.sourceLink a{color:#0a6246!important;font-weight:750;text-decoration:none}.hits{font-size:13px;color:#222!important;line-height:1.65;margin-top:10px}.hit{padding:10px 0;border-bottom:1px dashed #d8e1dc}.hit strong{color:#c9342d!important}.news{display:flex;gap:8px;flex-wrap:wrap;margin-top:7px}.news a{color:#111!important;text-decoration:none;background:#f2f7f4!important;border:1px solid #cfdad3;border-radius:10px;padding:6px 9px;font-weight:700}.empty{text-align:center;padding:36px;color:#333!important;background:#fff!important}@media(max-width:600px){.kstop{height:86px;padding:12px 14px}.kslogo{width:50px;height:50px;border-radius:17px}.kstitle{font-size:20px}.kssub{display:none}.logout{font-size:12px;padding:8px}.kswrap{margin-top:26px}.kscard{border-radius:28px;padding:24px 20px}.hero{font-size:41px}.dates{grid-template-columns:1fr}.stats{gap:7px}.stats div{padding:17px 12px;min-height:108px}.stats b{font-size:28px}.go{font-size:24px}.name{font-size:19px}.rise{font-size:22px}.head{align-items:flex-start}.tools{width:100%}.tools select{flex:1}}
    `}</style></div>
}
