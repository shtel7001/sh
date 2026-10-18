'use client';
import {useMemo,useRef,useState} from 'react';
const css=`*{box-sizing:border-box}body{margin:0;background:#eaf5ff;color:#17263c;font-family:Arial,sans-serif}main{width:100%;padding:10px}.hero{background:linear-gradient(110deg,#dcecff,#ede5ff,#dcf8eb);padding:18px;border-radius:12px}.hero h1{margin:0;font-size:30px}.hero p{margin:8px 0 0}.panel{background:#e7e6ff;padding:14px;border-radius:12px;margin:10px 0}.controls{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.control{background:#d8f2ff;padding:12px;border-radius:9px}label{display:block;font-weight:700;font-size:13px;margin-bottom:6px}input,select{width:100%;padding:10px;border:1px solid #9fb9cc;border-radius:7px;background:white;color:#17263c}.actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}button{padding:11px 18px;border:0;border-radius:8px;background:#427cc5;color:white;font-weight:800;cursor:pointer}button:disabled{opacity:.5}.secondary{background:#bdebd4;color:#123d2c}.stats{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}.stat{flex:1;min-width:110px;background:#dff4ed;padding:12px;border-radius:10px}.stat b{display:block;font-size:22px}.tablewrap{overflow:auto;background:#f1faff;border-radius:10px}table{width:100%;border-collapse:collapse;min-width:900px}th,td{padding:10px 8px;border-bottom:1px solid #ccdfeb;text-align:right;white-space:nowrap}th{background:#d9e8ff}th:first-child,td:first-child{text-align:left}a{color:#2756a8;font-weight:800}.note{font-size:12px;color:#4a6376;padding:10px}@media(max-width:850px){.controls{grid-template-columns:repeat(2,minmax(0,1fr))}.hero h1{font-size:24px}}@media(max-width:480px){.controls{grid-template-columns:1fr 1fr}main{padding:5px}.control{padding:7px}button{flex:1;padding:10px 6px}}`;
export default function Home(){
 const[market,setMarket]=useState('sp500'),[days,setDays]=useState(90),[proximity,setProximity]=useState(3),[breakPct,setBreakPct]=useState(1),[limit,setLimit]=useState(500);
 const[rows,setRows]=useState([]),[errorItems,setErrorItems]=useState([]),[showErrors,setShowErrors]=useState(false),[done,setDone]=useState(0),[total,setTotal]=useState(0),[errors,setErrors]=useState(0),[running,setRunning]=useState(false),[message,setMessage]=useState('검색 준비');
 const stop=useRef(false);
 const sorted=useMemo(()=>[...rows].sort((a,b)=>b.score-a.score),[rows]);
 async function run(){
  if(running)return;stop.current=false;setRunning(true);setRows([]);setErrorItems([]);setShowErrors(false);setDone(0);setErrors(0);setMessage('미국 주식 목록 수집 중');
  try{
   const u=await fetch('/api/universe?market='+market+'&limit='+limit).then(r=>r.json());
   if(!u.ok)throw Error(u.error||'종목 목록 조회 실패');
   const stocks=u.items||[];setTotal(stocks.length);let all=[],bad=0,failed=[];
   for(let i=0;i<stocks.length&&!stop.current;i+=12){
    const r=await fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stocks:stocks.slice(i,i+12),days,proximity,breakPct})}).then(x=>x.json());
    if(!r.ok)throw Error(r.error||'검색 오류');
    all=all.concat(r.hits||[]);failed=failed.concat(r.errors||[]);bad=failed.length;setRows([...all]);setErrorItems([...failed]);setErrors(bad);setDone(Math.min(stocks.length,i+12));setMessage('검색 중 · 후보 '+all.length+'종목');
   }
   setMessage(stop.current?'사용자 요청으로 검색 중지':'검색 완료');
  }catch(e){setMessage('오류: '+e.message)}finally{setRunning(false)}
 }
 async function excel(){
  if(!sorted.length)return;const XLSX=await import('xlsx');
  const data=sorted.map(r=>({'종목명(한글)':r.nameKo||r.name,'영문명':r.name,'티커':r.code,'섹터':r.sector||'미분류','시장':r.market,'현재가':r.current,'150일선':r.ma150,'기존저점':r.priorLow,'신규저점':r.newLow,'저점이탈율%':r.breakdownPct,'150일선거리%':r.distance,'점수':r.score,'선정사유':r.reason}));
  const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.json_to_sheet(data),'150일선 후보');if(errorItems.length)XLSX.utils.book_append_sheet(w,XLSX.utils.json_to_sheet(errorItems.map(x=>({'티커':x.code,'오류 사유':x.error}))),'데이터 오류');XLSX.writeFile(w,'US_MA150_support_'+new Date().toISOString().slice(0,10)+'.xlsx');
 }
 return <><style>{css}</style><main><div className="hero"><h1>🇺🇸 미국주식 · 150일선 저점 지지 레이더</h1><p>전저점 이탈 → 추가 하락 → 150일 이동평균선 접근 · S&P 500 / NASDAQ</p></div>
 <section className="panel"><div className="controls">
 <div className="control"><label>미국 주식 시장</label><select value={market} onChange={e=>setMarket(e.target.value)} disabled={running}><option value="sp500">S&P 500</option><option value="nasdaq">NASDAQ 시총 상위</option></select></div>
 <div className="control"><label>검색 종목 수</label><select value={limit} onChange={e=>setLimit(+e.target.value)} disabled={running}><option value="100">100종목</option><option value="300">300종목</option><option value="500">500종목</option></select></div>
 <div className="control"><label>전저점 탐색 기간 (거래일)</label><input type="number" min="30" max="240" value={days} onChange={e=>setDays(+e.target.value)}/></div>
 <div className="control"><label>150일선 접근 허용폭 (%)</label><input type="number" min=".5" max="15" step=".5" value={proximity} onChange={e=>setProximity(+e.target.value)}/></div>
 <div className="control"><label>전저점 최소 이탈폭 (%)</label><input type="number" min=".1" max="15" step=".5" value={breakPct} onChange={e=>setBreakPct(+e.target.value)}/></div>
 </div><div className="actions"><button onClick={run} disabled={running}>🔎 검색 시작</button><button className="secondary" onClick={()=>{stop.current=true}} disabled={!running}>⏹ 검색 중지</button><button className="secondary" onClick={excel} disabled={!rows.length}>📥 Excel 저장</button></div></section>
 <div className="stats"><div className="stat">진행<b>{done} / {total}</b></div><div className="stat">검색 후보<b>{rows.length}</b></div><div className="stat" style={{cursor:'pointer'}} onClick={()=>setShowErrors(!showErrors)}>데이터 오류<b>{errors}</b><span style={{fontSize:12}}>상세 {showErrors?'접기':'보기'} ▾</span></div><div className="stat">상태<b style={{fontSize:15}}>{message}</b></div></div>
 {showErrors&&<section className="panel" style={{background:'#fff0df'}}><h3>⚠️ 데이터 조회 실패 종목 · {errorItems.length}건</h3><p>Yahoo Finance 일봉 조회 실패 또는 150일선 계산에 필요한 데이터 부족입니다. 개별 사유를 확인하세요.</p>{errorItems.length?errorItems.map((x,i)=><div key={i} style={{padding:7,borderBottom:'1px solid #e5cdb3'}}><b>{x.code}</b> · {x.error}</div>):<p>실패 종목 없음</p>}</section>}
 <div className="tablewrap"><table><thead><tr><th>미국 주식 · 한글명</th><th>섹터</th><th>현재가 ($)</th><th>기존 저점</th><th>신규 저점</th><th>150일선</th><th>저점 이탈률</th><th>150일선 이격률</th><th>점수</th></tr></thead><tbody>{sorted.length?sorted.map(r=><tr key={r.code}><td><a href={'https://finance.yahoo.com/quote/'+encodeURIComponent(r.code)} target="_blank" rel="noreferrer">{r.code}</a><div style={{fontSize:13,fontWeight:700}}>{r.nameKo||r.name}</div><div style={{fontSize:11,color:'#607389'}}>{r.nameKo?r.name:''}</div></td><td>{r.sector||'미분류'}</td><td>{r.current.toFixed(2)}</td><td>{r.priorLow.toFixed(2)}</td><td>{r.newLow.toFixed(2)}</td><td>{r.ma150.toFixed(2)}</td><td>{r.breakdownPct.toFixed(2)}%</td><td>{r.distance.toFixed(2)}%</td><td><b>{r.score}</b></td></tr>):<tr><td colSpan="9" style={{textAlign:'center',padding:35}}>검색 시작을 누르면 후보가 표시됩니다.</td></tr>}</tbody></table></div>
 <div className="note">Yahoo Finance 비공식 일봉 · 미국 주식 전용 · 지지 여부는 기술적 후보 신호이며 실제 반등을 보장하지 않습니다.</div></main></>;
}