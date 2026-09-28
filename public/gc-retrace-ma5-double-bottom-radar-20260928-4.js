async function verifyOne(){
  try{ const code=$('verifyCode').value.trim(); if(!/^\d{6}$/.test(code))throw new Error('6자리 종목코드를 입력하세요.'); const all=await getMasterUniverse(); const stock=all.find(x=>x.code===code)||{code,name:code,market:'-'}; $('verifyMsg').textContent='가격 불러오는 중...'; const bars=await getHistory(stock); const endIdx=endIndexForDate(bars,$('asOf').value); if(endIdx<35)throw new Error('해당 기준일의 가격 이력이 부족합니다.'); const c=getCfg();validateCfg(c); const a=analyzeAt(bars,endIdx,c,true); if(!a){$('verifyBox').innerHTML='<b class="fail">골든크로스 후보 자체가 없습니다.</b>';return;} const r=makeResult(stock,bars,a,$('asOf').value); const cells=Object.entries(a.checks).map(([k,v])=>`<div><small>${esc(checkLabel(k))}</small><br><b class="${v?'pass':'fail'}">${v?'통과':'미통과'}</b></div>`).join(''); $('verifyBox').innerHTML=`<b>${esc(stock.name)} (${code}) · ${isoFromYmd(r.asOf)} 종가 ${fmt(r.asOfClose)}</b><div class="verify-grid">${cells}</div><p>교차 후 상승 ${pctText(a.rise)} · 조정 ${Number.isFinite(a.retr)?a.retr.toFixed(2)+'%':'-'} · MA5 저점 유사도 ${a.bottom?a.bottom.similarity.toFixed(2)+'%':'-'} · 저점 사이 반등 ${a.bottom?a.bottom.valleyRebound.toFixed(2)+'%':'-'}</p>`; $('verifyMsg').textContent=a.pass?'현재 설정으로 검출됩니다.':'현재 설정에서는 일부 조건이 미통과입니다.';
  }catch(e){$('verifyMsg').textContent=e.message||String(e);}
}
$('verifyBtn').addEventListener('click',verifyOne);

async function ensureAllHistories(rows){
  const missing=rows.filter(s=>!historyCache.has(s.code)); if(!missing.length)return;
  let cursor=0,done=0,fail=0; $('status').textContent=`백테스트용 가격 적재 중 · 캐시 ${fmt(historyCache.size)}개`; const total=missing.length;
  const worker=async()=>{while(true){if(stopRequested)return;const i=cursor++;if(i>=total)return;try{await getHistory(missing[i]);}catch(e){fail++;}done++;if(done%5===0||done===total)updateProgress(done,total,fail);}};
  const n=clamp(+$('concurrency').value||10,1,24); await Promise.all(Array.from({length:n},worker));
}
function referenceDates(rows,start,end){
  let best=[]; for(const s of rows){const b=historyCache.get(s.code);if(b&&b.length>best.length)best=b;} const a=toYmd(start),z=toYmd(end); return best.filter(x=>x.date>=a&&x.date<=z).map(x=>x.date);
}
function summaryForSignals(signals,forward){
  if(!signals.length)return {n:0,close:NaN,maxUp:NaN,hit5:NaN,hit10:NaN,down:NaN}; const mets=signals.map(r=>futureMetrics(historyCache.get(r.code),r.endIdx,forward)).filter(x=>Number.isFinite(x.maxUp)); if(!mets.length)return {n:signals.length,close:NaN,maxUp:NaN,hit5:NaN,hit10:NaN,down:NaN}; return {n:signals.length,close:avg(mets.map(x=>x.closeForward).filter(Number.isFinite)),maxUp:avg(mets.map(x=>x.maxUp)),hit5:mets.filter(x=>x.hit5).length/mets.length*100,hit10:mets.filter(x=>x.hit10).length/mets.length*100,down:avg(mets.map(x=>x.maxDown))};
}
async function runBacktest(){
  if(running)return; stopRequested=false; try{const c=getCfg();validateCfg(c);const rows=await loadUniverse();const s=$('btStart').value,e=$('btEnd').value;if(!s||!e||s>e)throw new Error('검증 시작일과 종료일을 확인하세요.');setRunning(true);startTimer();await ensureAllHistories(rows);if(stopRequested)return;const dates=referenceDates(rows,s,e);const step=clamp(+$('btStep').value||5,3,30),forward=clamp(+$('btForward').value||20,3,40),topN=clamp(+$('btTopN').value||30,1,100);const picked=dates.filter((_,i)=>i%step===0);backtestRows=[];let totalSignals=[];
    for(let di=0;di<picked.length;di++){if(stopRequested)break;const date=picked[di],signals=[];for(const stock of rows){const bars=historyCache.get(stock.code);if(!bars)continue;const endIdx=endIndexForDate(bars,date);if(endIdx<35)continue;const a=analyzeAt(bars,endIdx,c,false);if(a)signals.push(makeResult(stock,bars,a,date));}signals.sort((a,b)=>b.score-a.score);const chosen=signals.slice(0,topN);totalSignals.push(...chosen);const sm=summaryForSignals(chosen,forward);backtestRows.push({date,...sm});$('status').textContent=`백테스트 ${di+1}/${picked.length} · ${isoFromYmd(date)} · 신호 ${chosen.length}`;$('bar').style.width=`${picked.length?(di+1)/picked.length*100:0}%`;$('progressTxt').textContent=`${di+1} / ${picked.length}`;if(di%2===0)await sleep(0);}
    renderBacktest();const all=summaryForSignals(totalSignals,forward);$('backtestSummary').innerHTML=`<b>전체 ${fmt(totalSignals.length)}개 신호 인스턴스</b> · 평균 ${forward}거래일 종가수익 <b>${pctText(all.close)}</b> · 평균 기간내 최고상승 <b>${pctText(all.maxUp)}</b> · +5% 도달률 <b>${Number.isFinite(all.hit5)?all.hit5.toFixed(1)+'%':'-'}</b> · +10% 도달률 <b>${Number.isFinite(all.hit10)?all.hit10.toFixed(1)+'%':'-'}</b> · 평균 최대낙폭 <b>${pctText(all.down)}</b><br><span class="muted">같은 종목이 여러 기준일에 반복 검출되면 각각 하나의 신호로 집계합니다. 하루 신호는 점수 상위 ${topN}개까지만 사용합니다.</span>`; $('status').textContent=stopRequested?'백테스트 중지됨':'백테스트 완료';
  }catch(e){$('status').textContent=`백테스트 오류: ${e.message||e}`;}finally{setRunning(false);stopTimer();}
}
$('backtestBtn').addEventListener('click',runBacktest);
function renderBacktest(){ const tb=$('btBody'); if(!backtestRows.length){tb.innerHTML='<tr><td colspan="7" class="empty">백테스트 결과가 없습니다.</td></tr>';return;} tb.innerHTML=backtestRows.map(r=>`<tr><td>${isoFromYmd(r.date)}</td><td>${r.n}</td><td>${pctText(r.close)}</td><td>${pctText(r.maxUp)}</td><td>${Number.isFinite(r.hit5)?r.hit5.toFixed(1)+'%':'-'}</td><td>${Number.isFinite(r.hit10)?r.hit10.toFixed(1)+'%':'-'}</td><td>${pctText(r.down)}</td></tr>`).join(''); }

$('healthBtn').addEventListener('click',async()=>{try{$('status').textContent='데이터 연결 점검 중...';const [m,r]=await Promise.all([getMasterUniverse(),fetchWithRetry('/data/chart/005930',{},1)]);const b=parseFchart(await r.text());$('status').textContent=`정상 · 종목목록 ${fmt(m.length)}개 · 삼성전자 일봉 ${fmt(b.length)}개`;}catch(e){$('status').textContent=`연결 오류: ${e.message||e}`;}});
$('excelBtn').addEventListener('click',()=>{
  if(typeof XLSX==='undefined')return alert('Excel 모듈을 불러오지 못했습니다.'); if(!results.length)return; const rows=results.map((r,i)=>({
    '순위':i+1,'점수':r.score,'시장':r.market,'종목명':r.name,'종목코드':r.code,'기준일':isoFromYmd(r.asOf),'기준일종가':r.asOfClose,
    '골든크로스일':isoFromYmd(barsDate(r.code,r.gcIdx)),'교차후상승률':r.rise,'조정비율':r.retr,
    'MA5_1차저점':r.bottom?.b1,'MA5_1차저점일':isoFromYmd(barsDate(r.code,r.bottom?.b1Idx)),'MA5_2차저점':r.bottom?.b2,'MA5_2차저점일':isoFromYmd(barsDate(r.code,r.bottom?.b2Idx)),
    '저점유사도':r.bottom?.similarity,'저점사이반등':r.bottom?.valleyRebound,'향후3일':r.f.r3,'향후5일':r.f.r5,'향후10일':r.f.r10,'향후20일':r.f.r20,
    '20일내최고상승':r.f.maxUp,'20일내최대낙폭':r.f.maxDown,'네이버증권':`https://finance.naver.com/item/main.naver?code=${r.code}`
  })); const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'기준일검색');if(backtestRows.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(backtestRows),'기간백테스트');XLSX.writeFile(wb,`GC_50-80_MA5_쌍바닥_${$('asOf').value||'result'}.xlsx`);
});

(function init(){ $('asOf').value=localIsoDate(); $('btStart').value=daysAgo(150); $('btEnd').value=daysAgo(35); if(localStorage.getItem(DEVICE_KEY)===LOCK){showApp();loadUniverse();}else showLogin(); })();
