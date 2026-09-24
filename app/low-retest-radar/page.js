'use client';
import {useEffect,useMemo,useRef,useState} from 'react';

const css=`
*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#edf4fb,#f8fafc 420px);color:#14223a;font-family:Arial,'Noto Sans KR',sans-serif}button,select,input{font:inherit}main{max-width:1740px;margin:auto;padding:24px 20px 48px}.hero{display:flex;justify-content:space-between;gap:24px;align-items:center;background:linear-gradient(125deg,#102d57,#0b5997 70%,#0792a9);color:#fff;border-radius:24px;padding:31px 36px;box-shadow:0 16px 44px #12345a24}.ey{font-size:12px;letter-spacing:1.8px;color:#9be5ff;font-weight:900}.hero h1{margin:7px 0 8px;font-size:34px}.hero p{margin:0;color:#e6f3ff;line-height:1.7}.badge{min-width:248px;border:1px solid #ffffff55;background:#ffffff12;border-radius:18px;padding:16px 20px;text-align:center;font-weight:900;line-height:1.55}.panel{background:#fff;border:1px solid #dce5f0;border-radius:18px;box-shadow:0 8px 26px #1b35550d}.controls{margin-top:18px;padding:18px}.title{display:flex;align-items:center;gap:8px;font-size:18px;font-weight:900}.title i{font-style:normal;width:27px;height:27px;display:grid;place-items:center;border-radius:9px;background:#eaf2ff;color:#0d67e8;font-size:12px}.grid{margin-top:15px;display:grid;grid-template-columns:repeat(4,minmax(205px,1fr));gap:11px}.box{border:1px solid #e1e7ef;background:#fbfcff;border-radius:13px;padding:11px 12px}.box label{display:block;font-size:12px;color:#66778d;font-weight:900}.box b{float:right;color:#132844}.box select{width:100%;margin-top:8px;border:1px solid #d6dfeb;background:#fff;height:38px;border-radius:9px;padding:0 9px;font-weight:800;color:#14223a}.box input[type=range]{width:100%;margin-top:13px;accent-color:#176df5}.groupLabel{margin-top:18px;font-size:12px;font-weight:900;color:#38516f;letter-spacing:.3px}.toggles{display:flex;gap:20px;flex-wrap:wrap;margin-top:14px;color:#607187;font-size:12px}.toggles input{accent-color:#176df5}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.actions button{height:43px;border-radius:11px;padding:0 18px;font-weight:900;cursor:pointer}.pri{border:0;color:#fff;background:linear-gradient(90deg,#1069f7,#00a7df)}.danger{border:1px solid #ffd7d7;color:#c23b3b;background:#fff0f0}.ghost{border:1px solid #d9e2ec;color:#314765;background:#f4f7fb}.actions button:disabled{opacity:.5;cursor:not-allowed}.hint{margin-top:12px;color:#748297;font-size:12px;line-height:1.7}.example{margin-top:12px;border-radius:12px;padding:11px 13px;background:#eef8ff;border:1px solid #cfeafb;color:#315675;font-size:12px;line-height:1.65}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}.stat{background:#fff;border:1px solid #dce5f0;border-radius:13px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center}.stat span{font-size:11px;color:#718096}.stat strong{font-size:16px}.progress{height:6px;background:#dfe8f2;border-radius:999px;overflow:hidden;margin:9px 2px 14px}.progress i{display:block;height:100%;background:linear-gradient(90deg,#116cf5,#0cb88d);transition:width .2s}.result{overflow:hidden}.head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;padding:17px 18px;border-bottom:1px solid #dce5f0}.head h2{margin:0;font-size:18px}.head p{margin:5px 0 0;font-size:12px;color:#718096}.filter{width:260px;height:38px;border:1px solid #d7e0ea;border-radius:10px;padding:0 11px;outline:none}.wrap{overflow:auto;max-height:70vh}table{width:100%;border-collapse:separate;border-spacing:0;min-width:2200px;font-size:12px}th{position:sticky;top:0;z-index:2;background:#f4f7fb;color:#50627a;padding:10px 8px;border-bottom:1px solid #dce5f0;text-align:right;white-space:nowrap}th:nth-child(1),th:nth-child(2),th:nth-child(3),th:nth-child(4),th:nth-last-child(-n+3){text-align:center}td{padding:9px 8px;border-bottom:1px solid #eef2f6;text-align:right;white-space:nowrap;background:#fff}tr:hover td{background:#fafcff}.stock{text-align:left!important;font-weight:900}.center{text-align:center!important}.pill{display:inline-block;padding:3px 7px;border-radius:999px;background:#eaf2ff;color:#1268e7;font-weight:900}.stateIn{display:inline-block;padding:4px 7px;border-radius:999px;background:#e8faf3;color:#087a55;font-weight:900}.stateUp{display:inline-block;padding:4px 7px;border-radius:999px;background:#fff2ed;color:#c24b27;font-weight:900}.stateDown{display:inline-block;padding:4px 7px;border-radius:999px;background:#eef2ff;color:#4b5fb5;font-weight:900}.good{color:#079365;font-weight:900}.up{color:#d64444;font-weight:900}.links{text-align:center!important}.links a{display:inline-block;margin:0 2px;padding:4px 6px;border-radius:7px;background:#f0f4f8;color:#354b66;text-decoration:none;font-size:11px}.spark{width:142px;height:42px}.spark polyline{fill:none;stroke:#176df5;stroke-width:1.9}.empty{text-align:center!important;padding:48px!important;color:#7b899c}.auth{position:fixed;inset:0;background:#0e1a2ebd;backdrop-filter:blur(7px);z-index:50;display:grid;place-items:center;padding:18px}.authCard{width:min(420px,100%);background:#fff;border-radius:22px;padding:28px;box-shadow:0 30px 90px #0004}.logo{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:#176df5;color:#fff;font-weight:900}.authCard h2{margin:14px 0 8px}.authCard p{font-size:13px;color:#66758a;line-height:1.6}.authCard input{width:100%;height:46px;border:1px solid #d5deea;border-radius:11px;text-align:center;font-size:18px;letter-spacing:3px;outline:none}.authCard button{width:100%;height:44px;margin-top:10px;border:0;border-radius:11px;background:#176df5;color:#fff;font-weight:900}.authMsg{min-height:18px;margin-top:8px;color:#d33f3f;font-size:12px;text-align:center}.topBtn{border:1px solid #ffffff55;background:#ffffff14;color:#fff;border-radius:10px;padding:8px 10px;font-size:11px;font-weight:800;cursor:pointer}.foot{font-size:11px;color:#7a899d;line-height:1.65;padding:18px 2px;text-align:center}@media(max-width:1100px){main{padding:14px}.hero{padding:24px}.badge{display:none}.grid{grid-template-columns:1fr 1fr}.stats{grid-template-columns:1fr 1fr}}@media(max-width:640px){.grid{grid-template-columns:1fr}.hero h1{font-size:27px}.head{align-items:flex-start;flex-direction:column}.filter{width:100%}.actions button{flex:1}.stats{grid-template-columns:1fr}.hero{align-items:flex-start}}
`;

const fmt=n=>Number.isFinite(+n)?Math.round(+n).toLocaleString('ko-KR'):'-';
const signed=n=>`${n>=0?'+':''}${Number(n).toFixed(1)}%`;
const special=n=>/(스팩|SPAC|우$|우B$|우C$|1우|2우|3우|우선)/i.test(String(n||'').trim());
const stateClass=s=>s==='구간 안'?'stateIn':s==='구간 상향 이탈'?'stateUp':'stateDown';

function RangeBox({label,value,setValue,min,max,step=1,suffix=''}){
  return <div className="box"><label>{label}<b>{value}{suffix}</b></label><input type="range" min={min} max={max} step={step} value={value} onChange={e=>setValue(Number(e.target.value))}/></div>;
}

function Spark({d,zoneLow,zoneHigh}){
  if(!d?.length)return '-';
  const a=d.map(x=>x[1]),mn=Math.min(...a,zoneLow||Infinity),mx=Math.max(...a,zoneHigh||-Infinity),w=142,h=42,p=3,span=Math.max(1,mx-mn);
  const y=v=>h-p-(v-mn)*(h-2*p)/span;
  const pts=a.map((v,i)=>`${p+i*(w-2*p)/Math.max(1,a.length-1)},${y(v)}`).join(' ');
  const zTop=Math.min(y(zoneHigh),y(zoneLow)),zH=Math.max(1,Math.abs(y(zoneLow)-y(zoneHigh)));
  return <svg className="spark" viewBox={`0 0 ${w} ${h}`}><rect x="0" y={zTop} width={w} height={zH} fill="#14b87a" opacity="0.11"/><polyline points={pts}/></svg>;
}

export default function Home(){
  const [authed,setAuthed]=useState(null),[code,setCode]=useState(''),[authMsg,setAuthMsg]=useState('');
  const [market,setMarket]=useState('both'),[days,setDays]=useState(60),[riseMin,setRiseMin]=useState(10),[riseMax,setRiseMax]=useState(100);
  const [zoneMin,setZoneMin]=useState(14),[zoneMax,setZoneMax]=useState(23);
  const [lowPeakMin,setLowPeakMin]=useState(5),[lowPeakMax,setLowPeakMax]=useState(20);
  const [peakRetestMin,setPeakRetestMin]=useState(3),[peakRetestMax,setPeakRetestMax]=useState(30);
  const [zoneDaysMin,setZoneDaysMin]=useState(2),[zoneDaysMax,setZoneDaysMax]=useState(20),[retestRecentMax,setRetestRecentMax]=useState(20);
  const [mode,setMode]=useState('recent'),[maxStocks,setMaxStocks]=useState(2500),[exclude,setExclude]=useState(true),[strictLow,setStrictLow]=useState(true),[useIntraday,setUseIntraday]=useState(true),[noNewLow,setNoNewLow]=useState(false);
  const [running,setRunning]=useState(false),[prog,setProg]=useState({done:0,total:0}),[results,setResults]=useState([]),[errors,setErrors]=useState(0),[msg,setMsg]=useState('검색 준비'),[filter,setFilter]=useState('');
  const stopRef=useRef(false);

  useEffect(()=>{fetch('/api/low-retest-radar/auth/status',{cache:'no-store'}).then(r=>r.json()).then(j=>setAuthed(!!j.authenticated)).catch(()=>setAuthed(false))},[]);
  const shown=useMemo(()=>results.filter(x=>!filter||x.name.toLowerCase().includes(filter.toLowerCase())||x.code.includes(filter)).sort((a,b)=>a.matchScore-b.matchScore||b.lastRetestDate.localeCompare(a.lastRetestDate)),[results,filter]);

  async function login(){setAuthMsg('');try{const r=await fetch('/api/low-retest-radar/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});if(!r.ok)throw new Error('인증번호가 맞지 않습니다.');setAuthed(true);setCode('')}catch(e){setAuthMsg(e.message)}}
  async function logout(){await fetch('/api/low-retest-radar/auth/logout',{method:'POST'});setAuthed(false)}

  async function loadUniverse(){
    const ms=market==='both'?['kospi','kosdaq']:[market];let all=[];
    for(const m of ms){
      setMsg(`${m.toUpperCase()} 종목 목록을 불러오는 중…`);
      const r=await fetch(`/api/low-retest-radar/universe?market=${m}&limit=${maxStocks}`,{cache:'no-store'});
      if(r.status===401){setAuthed(false);throw new Error('인증이 필요합니다.')}
      const j=await r.json();if(!j.ok)throw new Error(j.error||'종목 목록 오류');all=all.concat(j.items||[]);
    }
    const seen=new Set();all=all.filter(x=>!seen.has(x.code)&&(seen.add(x.code),true));if(exclude)all=all.filter(x=>!special(x.name));return all;
  }

  async function run(){
    if(running)return;stopRef.current=false;setRunning(true);setResults([]);setErrors(0);setProg({done:0,total:0});
    try{
      const stocks=await loadUniverse();setProg({done:0,total:stocks.length});setMsg(`총 ${stocks.length.toLocaleString()}종목 분석 시작`);
      let idx=0,all=[],err=0;
      const conf={days,riseMin,riseMax,zoneMin,zoneMax,lowPeakMin,lowPeakMax,peakRetestMin,peakRetestMax,zoneDaysMin,zoneDaysMax,retestRecentMax,mode,strictLow,useIntraday,noNewLow};
      const workers=Math.min(3,Math.max(1,Math.ceil(stocks.length/20)));
      async function worker(){
        while(!stopRef.current){
          const start=idx;idx+=20;if(start>=stocks.length)return;const part=stocks.slice(start,start+20);
          try{
            const r=await fetch('/api/low-retest-radar/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stocks:part,...conf})});
            if(r.status===401){setAuthed(false);stopRef.current=true;throw new Error('인증이 필요합니다.')}
            const j=await r.json();if(!j.ok)throw new Error(j.error||'스캔 오류');all=all.concat(j.hits||[]);err+=j.errors?.length||0;
          }catch{err+=part.length}
          setResults([...all]);setErrors(err);setProg(p=>({done:Math.min(p.done+part.length,stocks.length),total:stocks.length}));setMsg(`${Math.min(start+part.length,stocks.length).toLocaleString()} / ${stocks.length.toLocaleString()} 분석 · 조건 일치 ${all.length}개`);
        }
      }
      await Promise.all(Array.from({length:workers},worker));
      if(stopRef.current)setMsg(`중지됨 · ${all.length}개 후보 저장 가능`);else setMsg(`완료 · ${stocks.length.toLocaleString()}종목 중 ${all.length}개 조건 일치`);
    }catch(e){setMsg(`오류: ${e.message||e}`)}finally{setRunning(false)}
  }

  function stop(){stopRef.current=true;setMsg('중지 요청됨…')}

  async function excel(){
    if(!shown.length)return;
    const XLSX=await import('xlsx');
    const rows=shown.map((r,i)=>({
      '순번':i+1,'시장':r.market,'종목명':r.name,'종목코드':r.code,'시총순위':r.rank,'현재가':Math.round(r.current),'현재상태':r.currentState,
      '기준저점':Math.round(r.lowPrice),'저점일':r.lowDate,'반등고점':Math.round(r.peakPrice),'고점일':r.peakDate,'반등률(%)':+r.risePct.toFixed(2),
      '재진입구간 하단':Math.round(r.zoneLow),'재진입구간 상단':Math.round(r.zoneHigh),'첫 재진입일':r.firstRetestDate,'마지막 재진입일':r.lastRetestDate,
      '구간 터치일수':r.touchDays,'구간 체류일수':r.residenceDays,'재진입 후 경과일':r.retestAge,'저점→고점 거래일':r.lowToPeak,'고점→재진입 거래일':r.peakToRetest,
      '현재/구간중앙(%)':+r.distancePct.toFixed(2),'고점대비(%)':+r.drawdownPct.toFixed(2),'시가총액(억원)':r.marketCapEok,'데이터소스':r.source,
      '네이버증권':`https://finance.naver.com/item/main.naver?code=${r.code}`,'네이버뉴스':`https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(r.name)}`
    }));
    const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();ws['!cols']=Array.from({length:27},(_,i)=>({wch:[6,9,18,11,9,12,14,12,12,12,12,12,14,14,12,12,12,12,14,16,16,16,14,16,11,42,42][i]||13}));XLSX.utils.book_append_sheet(wb,ws,'재진입후보');
    const info=XLSX.utils.aoa_to_sheet([['검색 조건','값'],['시장',market],['검색기간',`${days} 거래일`],['저점→고점 반등률',`${riseMin}% ~ ${riseMax}%`],['재진입 구간',`저점 대비 +${zoneMin}% ~ +${zoneMax}%`],['저점→고점',`${lowPeakMin} ~ ${lowPeakMax} 거래일`],['고점→재진입',`${peakRetestMin} ~ ${peakRetestMax} 거래일`],['구간 체류',`${zoneDaysMin} ~ ${zoneDaysMax} 거래일`],['마지막 재진입 최근',`${retestRecentMax} 거래일 이내`],['검색 모드',mode==='inside'?'현재 구간 안':'최근 재진입 이력'],['장중 고저가 포함',useIntraday?'예':'아니오'],['엄격 저점',strictLow?'예':'아니오'],['재진입 후 신저점 금지',noNewLow?'예':'아니오'],['생성시각',new Date().toLocaleString('ko-KR')]]);XLSX.utils.book_append_sheet(wb,info,'검색조건');
    XLSX.writeFile(wb,`저점반등_재진입_스크리너_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  const pctDone=prog.total?prog.done/prog.total*100:0;
  return <>
    <style>{css}</style>
    {authed===false&&<div className="auth"><div className="authCard"><div className="logo">R</div><h2>개인 인증</h2><p>기존과 같은 인증 방식입니다. 한 번 인증하면 이 기기에 장기 저장되고, 다른 PC에서도 같은 번호를 다시 입력해 사용할 수 있습니다.</p><input value={code} onChange={e=>setCode(e.target.value)} onKeyDown={e=>e.key==='Enter'&&login()} inputMode="numeric" placeholder="인증번호"/><button onClick={login}>인증하고 시작</button><div className="authMsg">{authMsg}</div></div></div>}
    <main>
      <section className="hero"><div><div className="ey">LOW → SURGE → RETEST ZONE · 2026</div><h1>저점 반등 후 재진입 스크리너</h1><p>저점에서 크게 반등한 뒤 <b>저점 위 일정 가격대</b>로 다시 내려와 머문 종목을 찾습니다. 현재 구간 안의 종목뿐 아니라 최근 구간을 거쳐 다시 튄 종목도 찾을 수 있습니다.</p></div><div><div className="badge">한선엔지니어링형 기본값<br/>60일 · 반등 +10~100%<br/>저점 대비 +14~23% 재진입</div><button className="topBtn" onClick={logout}>인증 초기화</button></div></section>

      <section className="panel controls">
        <div className="title"><i>1</i>검색 조건</div>
        <div className="grid">
          <div className="box"><label>시장</label><select value={market} onChange={e=>setMarket(e.target.value)}><option value="both">코스피 + 코스닥</option><option value="kospi">코스피</option><option value="kosdaq">코스닥</option></select></div>
          <RangeBox label="검색기간" value={days} setValue={setDays} min={30} max={180} suffix="일"/>
          <RangeBox label="반등 최소" value={riseMin} setValue={setRiseMin} min={5} max={150} suffix="%"/>
          <RangeBox label="반등 최대" value={riseMax} setValue={setRiseMax} min={10} max={200} suffix="%"/>
          <RangeBox label="재진입 구간 하단" value={zoneMin} setValue={setZoneMin} min={0} max={50} suffix="%"/>
          <RangeBox label="재진입 구간 상단" value={zoneMax} setValue={setZoneMax} min={1} max={80} suffix="%"/>
          <div className="box"><label>검색 모드</label><select value={mode} onChange={e=>setMode(e.target.value)}><option value="recent">최근 재진입 이력 포함</option><option value="inside">현재 재진입 구간 안만</option></select></div>
          <div className="box"><label>시장당 최대 종목<b>{maxStocks.toLocaleString()}</b></label><select value={maxStocks} onChange={e=>setMaxStocks(Number(e.target.value))}><option value={500}>500</option><option value={1000}>1,000</option><option value={1500}>1,500</option><option value={2500}>전체에 가깝게</option></select></div>
        </div>

        <div className="groupLabel">날짜·패턴을 세밀하게 조절</div>
        <div className="grid">
          <RangeBox label="저점→고점 최소" value={lowPeakMin} setValue={setLowPeakMin} min={1} max={30} suffix="일"/>
          <RangeBox label="저점→고점 최대" value={lowPeakMax} setValue={setLowPeakMax} min={2} max={60} suffix="일"/>
          <RangeBox label="고점→재진입 최소" value={peakRetestMin} setValue={setPeakRetestMin} min={1} max={30} suffix="일"/>
          <RangeBox label="고점→재진입 최대" value={peakRetestMax} setValue={setPeakRetestMax} min={2} max={70} suffix="일"/>
          <RangeBox label="구간 체류 최소" value={zoneDaysMin} setValue={setZoneDaysMin} min={1} max={20} suffix="일"/>
          <RangeBox label="구간 체류 최대" value={zoneDaysMax} setValue={setZoneDaysMax} min={1} max={40} suffix="일"/>
          <RangeBox label="마지막 재진입 최근" value={retestRecentMax} setValue={setRetestRecentMax} min={0} max={60} suffix="일 이내"/>
        </div>

        <div className="toggles">
          <label><input type="checkbox" checked={exclude} onChange={e=>setExclude(e.target.checked)}/> 우선주·스팩 추정 종목 제외</label>
          <label><input type="checkbox" checked={strictLow} onChange={e=>setStrictLow(e.target.checked)}/> 기준저점 이후 고점 전 신저점 불허</label>
          <label><input type="checkbox" checked={useIntraday} onChange={e=>setUseIntraday(e.target.checked)}/> 장중 저가·고가가 구간에 닿아도 재진입 인정</label>
          <label><input type="checkbox" checked={noNewLow} onChange={e=>setNoNewLow(e.target.checked)}/> 고점 이후 기준저점 이탈 종목 제외</label>
        </div>
        <div className="actions"><button className="pri" onClick={run} disabled={running}>{running?'검색 중…':'전체 종목 검색'}</button><button className="danger" onClick={stop} disabled={!running}>중지</button><button className="ghost" onClick={excel} disabled={!shown.length}>Excel(.xlsx) 저장</button></div>
        <div className="example"><b>현재 차트 기준 보정:</b> 한선엔지니어링의 8,610원 저점에 +14~23%를 적용하면 약 <b>9,815~10,590원</b>입니다. 요청하신 9,800~10,600원 구간과 거의 일치하도록 기본값을 맞췄습니다. 반등 고점 14,900원(+약 73%)도 잡히도록 반등 상한을 넓혔습니다.</div>
        <div className="hint">“최근 재진입 이력 포함”은 한선엔지니어링처럼 이미 구간을 거쳐 위로 튄 종목도 결과에 남깁니다. 실제 매수 후보처럼 <b>지금 그 구간 안에 있는 종목만</b> 보려면 검색 모드를 “현재 재진입 구간 안만”으로 바꾸면 됩니다.</div>
      </section>

      <div className="stats"><div className="stat"><span>상태</span><strong>{msg}</strong></div><div className="stat"><span>진행</span><strong>{prog.done.toLocaleString()} / {prog.total.toLocaleString()}</strong></div><div className="stat"><span>조건 일치</span><strong>{results.length.toLocaleString()}</strong></div><div className="stat"><span>오류/데이터부족</span><strong>{errors.toLocaleString()}</strong></div></div>
      <div className="progress"><i style={{width:`${pctDone}%`}}/></div>

      <section className="panel result"><div className="head"><div><h2>검색 결과</h2><p>현재 구간 안 → 구간 근접 → 최근 재진입 순으로 정렬합니다. 초록 띠가 각 종목의 재진입 가격대입니다.</p></div><input className="filter" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="종목명·코드 검색"/></div>
        <div className="wrap"><table><thead><tr><th>#</th><th>시장</th><th>종목</th><th>코드</th><th>현재가</th><th>상태</th><th>기준저점</th><th>저점일</th><th>반등고점</th><th>고점일</th><th>반등률</th><th>재진입 하단</th><th>재진입 상단</th><th>첫 재진입</th><th>마지막 재진입</th><th>터치일</th><th>체류일</th><th>재진입 경과</th><th>저점→고점</th><th>고점→재진입</th><th>현재/구간중앙</th><th>고점대비</th><th>차트</th><th>링크</th></tr></thead><tbody>
          {!shown.length?<tr><td colSpan={24} className="empty">{running?'조건에 맞는 종목을 찾는 중입니다…':'검색 버튼을 누르면 코스피·코스닥을 스크리닝합니다.'}</td></tr>:shown.map((r,i)=><tr key={`${r.code}-${r.lowDate}-${r.peakDate}`}><td className="center">{i+1}</td><td className="center"><span className="pill">{r.market}</span></td><td className="stock">{r.name}</td><td className="center">{r.code}</td><td>{fmt(r.current)}</td><td className="center"><span className={stateClass(r.currentState)}>{r.currentState}</span></td><td>{fmt(r.lowPrice)}</td><td>{r.lowDate}</td><td>{fmt(r.peakPrice)}</td><td>{r.peakDate}</td><td className="up">+{r.risePct.toFixed(1)}%</td><td>{fmt(r.zoneLow)}</td><td>{fmt(r.zoneHigh)}</td><td>{r.firstRetestDate}</td><td>{r.lastRetestDate}</td><td>{r.touchDays}일</td><td>{r.residenceDays}일</td><td>{r.retestAge}일</td><td>{r.lowToPeak}일</td><td>{r.peakToRetest}일</td><td className={Math.abs(r.distancePct)<=5?'good':''}>{signed(r.distancePct)}</td><td>{signed(r.drawdownPct)}</td><td className="center"><Spark d={r.spark} zoneLow={r.zoneLow} zoneHigh={r.zoneHigh}/></td><td className="links"><a target="_blank" rel="noopener" href={`https://finance.naver.com/item/main.naver?code=${r.code}`}>네이버</a><a target="_blank" rel="noopener" href={`https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(r.name)}`}>뉴스</a></td></tr>)}
        </tbody></table></div>
      </section>
      <div className="foot">패턴 탐색용 도구입니다. 일봉 데이터 제공 시점과 장중 가격 변동에 따라 결과가 달라질 수 있습니다.</div>
    </main>
  </>;
}
