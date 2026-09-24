'use client';
import {useMemo,useState} from 'react';

const css=`*{box-sizing:border-box}body{margin:0;background:#f3f4f1;color:#161b24;font-family:Arial,'Noto Sans KR',sans-serif}main{max-width:1180px;margin:auto;padding:38px 20px 54px}.hero{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:end;margin-bottom:28px}.hero h1{font-size:52px;line-height:1.05;letter-spacing:-2px;margin:0 0 12px}.hero p{color:#657083;max-width:520px;line-height:1.7}.wave{height:145px;border-bottom:2px solid #1f56c4;position:relative;overflow:hidden}.wave:before{content:'';position:absolute;left:0;right:0;bottom:5px;height:100px;background:repeating-radial-gradient(ellipse at 10% 100%,transparent 0 34px,#161b24 35px 36px,transparent 37px 70px);opacity:.75}.panel{background:#fbfbf9;border-top:2px solid #161b24;border-bottom:1px solid #dcdfe3;padding:22px}.controls{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:26px 40px}.label{font-size:13px;color:#657083;font-weight:700;margin-bottom:9px}.seg{display:flex;border:1px solid #161b24;border-radius:6px;overflow:hidden}.seg button{flex:1;border:0;background:#fff;padding:12px;font-weight:800}.seg button.on{background:#161b24;color:#fff}.rangehead{display:flex;justify-content:space-between;align-items:end}.rangehead b{font-size:22px}.range input{width:100%;accent-color:#1f56c4}.actions{display:flex;gap:14px;align-items:center;margin-top:24px}.btn{border:1px solid #161b24;background:#161b24;color:#fff;border-radius:6px;padding:12px 22px;font-weight:800;cursor:pointer}.btn.ghost{background:#fff;color:#161b24}.btn:disabled{opacity:.45;cursor:not-allowed}.status{margin-top:18px}.bar{height:6px;background:#e9ebee;border-radius:9px;overflow:hidden}.bar i{display:block;height:100%;background:#1f56c4}.stats{display:flex;flex-wrap:wrap;gap:26px;margin:12px 0}.stat span{display:block;font-size:12px;color:#657083}.stat b{font-size:22px}.msg{color:#657083}.toolbar{display:flex;gap:12px;align-items:center;margin:22px 0 12px}.toolbar .grow{flex:1}.toolbar select{padding:9px;border:1px solid #dcdfe3;border-radius:6px;background:#fff;font-weight:700}.tablewrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:1050px}th,td{padding:12px 10px;border-bottom:1px solid #dcdfe3;text-align:right;white-space:nowrap}th{font-size:12px;color:#657083}th:first-child,td:first-child{text-align:left}.stock a{font-size:16px;font-weight:900;color:#161b24;text-decoration:none;border-bottom:2px solid #1f56c4}.stock small{display:block;color:#657083;margin-top:3px}.low{color:#1f56c4;font-weight:800}.high{color:#cf3a3a;font-weight:800}.score{font-size:18px;font-weight:900}.spark{width:120px;height:38px}.spark polyline{fill:none;stroke:#161b24;stroke-width:1.7}.empty{text-align:center!important;color:#657083;padding:35px!important}.notes{margin-top:20px;color:#657083;font-size:13px;line-height:1.7}@media(max-width:850px){main{padding:22px 14px}.hero{grid-template-columns:1fr}.hero h1{font-size:38px}.wave{height:90px}.controls{grid-template-columns:1fr}.toolbar{align-items:stretch;flex-wrap:wrap}}`;

const money=v=>v==null?'-':'$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const cap=v=>v==null?'-':v>=1000?'$'+(v/1000).toFixed(2)+'T':'$'+Number(v).toFixed(1)+'B';
function Spark({d}){if(!d?.length)return'-';const a=d.map(x=>x[1]),mn=Math.min(...a),mx=Math.max(...a),w=120,h=38,p=3;const pts=a.map((v,i)=>`${p+i*(w-2*p)/Math.max(1,a.length-1)},${h-p-(v-mn)*(h-2*p)/Math.max(1,mx-mn)}`).join(' ');return <svg className="spark" viewBox={`0 0 ${w} ${h}`}><polyline points={pts}/></svg>}

export default function Home(){
  const[market,setMarket]=useState('sp500');
  const[days,setDays]=useState(120);
  const[proximity,setProximity]=useState(5);
  const[running,setRunning]=useState(false);
  const[prog,setProg]=useState({done:0,total:0});
  const[results,setResults]=useState([]);
  const[errors,setErrors]=useState([]);
  const[msg,setMsg]=useState('검색 준비');
  const[sort,setSort]=useState('score');
  const[desc,setDesc]=useState(true);

  const shown=useMemo(()=>{
    const a=[...results];
    const val=r=>sort==='distance'?-Math.abs(r.distance):sort==='amplitude'?r.amplitude:sort==='rank'?-r.rank:r.score;
    a.sort((x,y)=>(desc?val(y)-val(x):val(x)-val(y))||(y.score-x.score));
    return a;
  },[results,sort,desc]);

  async function run(){
    if(running)return;
    setRunning(true);setResults([]);setErrors([]);setProg({done:0,total:0});
    setMsg(market==='nasdaq'?'NASDAQ 시총 상위 500 종목을 불러오는 중…':'S&P 500 구성 종목을 불러오는 중…');
    try{
      const u=await fetch(`/api/universe?market=${market}&limit=500`,{cache:'no-store'}).then(r=>r.json());
      if(!u.ok)throw new Error(u.error||'종목 목록 오류');
      const stocks=u.items||[];setProg({done:0,total:stocks.length});
      let all=[],err=[];
      for(let i=0;i<stocks.length;i+=12){
        const part=stocks.slice(i,i+12);
        const r=await fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stocks:part,days,proximity})}).then(x=>x.json());
        if(!r.ok)throw new Error(r.error||'스캔 오류');
        all=all.concat(r.hits||[]);err=err.concat(r.errors||[]);
        setResults([...all]);setErrors([...err]);
        const done=Math.min(i+part.length,stocks.length);setProg({done,total:stocks.length});
        setMsg(`${done} / ${stocks.length} 분석 · 후보 ${all.length}개`);
      }
      setMsg(`검색 완료 · ${stocks.length}종목 중 후보 ${all.length}개`);
    }catch(e){setMsg(`오류: ${e.message||e}`)}finally{setRunning(false)}
  }

  async function excel(){
    if(!shown.length)return;
    const XLSX=await import('xlsx');
    const rows=shown.map(r=>({'시총순위':r.rank,'티커':r.code,'종목명':r.name,'시장':r.market,'시가총액($B)':r.marketCapB??'','현재가':+r.current.toFixed(2),'반복저점':+r.support.toFixed(2),'저점터치(회)':r.pivotLows,'반복고점':+r.resistance.toFixed(2),'고점터치(회)':r.pivotHighs,'저점거리(%)':+r.distance.toFixed(2),'변동폭(%)':+r.amplitude.toFixed(2),'사이클(회)':r.cycles,'종합점수':r.score,'데이터소스':r.source,'선정이유':r.reason,'Yahoo Finance':`https://finance.yahoo.com/quote/${encodeURIComponent(r.yahoo||r.code)}`}));
    const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();
    ws['!autofilter']={ref:ws['!ref']};ws['!cols']=[9,11,28,12,14,11,11,12,11,12,12,11,10,10,15,55,45].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb,ws,'후보 종목');
    const info=XLSX.utils.aoa_to_sheet([['대상',market==='nasdaq'?'NASDAQ 시총 상위 500':'S&P 500'],['검색기간(거래일)',days],['저점 접근 허용폭(%)',proximity],['분석 종목수',prog.done],['후보수',shown.length],['오류수',errors.length],['저장 시각',new Date().toLocaleString('ko-KR')]]);
    XLSX.utils.book_append_sheet(wb,info,'검색 조건');
    XLSX.writeFile(wb,`저점스크리너_${market}_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  return <><style>{css}</style><main>
    <section className="hero"><div><h1>저점 접근<br/>스크리너</h1><p>같은 바닥을 여러 번 찍고 올라갔던 종목 중, 지금 그 바닥 근처에 있는 종목을 찾습니다.</p></div><div className="wave"/></section>
    <section className="panel"><div className="controls">
      <div><div className="label">대상</div><div className="seg"><button className={market==='sp500'?'on':''} onClick={()=>setMarket('sp500')} disabled={running}>S&amp;P 500</button><button className={market==='nasdaq'?'on':''} onClick={()=>setMarket('nasdaq')} disabled={running}>NASDAQ 시총 500</button></div></div>
      <div className="range"><div className="rangehead"><span className="label">검색기간</span><b>{days} 거래일</b></div><input type="range" min="1" max="240" value={days} onChange={e=>setDays(+e.target.value)} disabled={running}/></div>
      <div className="range"><div className="rangehead"><span className="label">저점 접근 허용폭</span><b>{proximity}%</b></div><input type="range" min="1" max="20" value={proximity} onChange={e=>setProximity(+e.target.value)} disabled={running}/></div>
    </div><div className="actions"><button className="btn" onClick={run} disabled={running}>{running?'검색 중…':'검색 시작'}</button><button className="btn ghost" onClick={excel} disabled={!shown.length||running}>Excel 저장 (.xlsx)</button></div></section>
    <section className="status"><div className="bar"><i style={{width:`${prog.total?prog.done/prog.total*100:0}%`}}/></div><div className="stats"><div className="stat"><span>진행 종목</span><b>{prog.done} / {prog.total}</b></div><div className="stat"><span>후보</span><b>{results.length}</b></div><div className="stat"><span>오류</span><b>{errors.length}</b></div></div><div className="msg">{msg}</div></section>
    <div className="toolbar"><label>정렬 <select value={sort} onChange={e=>setSort(e.target.value)}><option value="score">종합점수</option><option value="distance">저점거리</option><option value="amplitude">변동폭</option><option value="rank">시총순위</option></select></label><button className="btn ghost" onClick={()=>setDesc(v=>!v)}>{desc?'높은 순':'낮은 순'}</button><span className="grow"/></div>
    <div className="tablewrap"><table><thead><tr><th>종목</th><th>시가총액</th><th>현재가</th><th>반복저점</th><th>반복고점</th><th>저점거리</th><th>변동폭</th><th>사이클</th><th>종합점수</th><th>최근 60일</th></tr></thead><tbody>{shown.length===0?<tr><td colSpan="10" className="empty">검색을 실행하면 조건에 맞는 종목이 표시됩니다.</td></tr>:shown.map(r=><tr key={`${r.market}-${r.code}`}><td className="stock"><a href={`https://finance.yahoo.com/quote/${encodeURIComponent(r.yahoo||r.code)}`} target="_blank" rel="noreferrer">{r.code}</a><small>{r.name} · 시총 {r.rank}위</small></td><td>{cap(r.marketCapB)}</td><td>{money(r.current)}</td><td className="low">{money(r.support)}<small> · {r.pivotLows}회</small></td><td className="high">{money(r.resistance)}<small> · {r.pivotHighs}회</small></td><td><b>{r.distance>=0?'+':''}{r.distance.toFixed(1)}%</b></td><td>+{r.amplitude.toFixed(1)}%</td><td>{r.cycles}회</td><td className="score">{r.score}</td><td><Spark d={r.spark}/></td></tr>)}</tbody></table></div>
    <div className="notes"><b>점수 구조:</b> 저점거리 30점 · 사이클 25점 · 저점 반복성 15점 · 고점 반복성 10점 · 변동폭 20점. 시세는 Yahoo Finance 비공식 일봉 데이터이며 지연·누락될 수 있습니다. 참고용이며 투자 권유가 아닙니다.</div>
  </main></>;
}
