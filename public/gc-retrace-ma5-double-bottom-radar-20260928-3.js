  try{ validateCfg(c); const asOf=toYmd($('asOf').value); if(!/^\d{8}$/.test(asOf))throw new Error('기준일을 선택하세요.'); const rows=await loadUniverse(); results=[]; renderResults(); setRunning(true); startTimer();
    let cursor=0,done=0,fail=0; $('status').textContent=`${isoFromYmd(asOf)} 기준 전종목 검색 중...`; $('matchN').textContent='0';
    const worker=async()=>{ while(true){ if(stopRequested)return; const idx=cursor++; if(idx>=rows.length)return; const stock=rows[idx]; try{ const bars=await getHistory(stock); const endIdx=endIndexForDate(bars,asOf); if(endIdx>=0){const a=analyzeAt(bars,endIdx,c,false);if(a){results.push(makeResult(stock,bars,a,asOf));$('matchN').textContent=fmt(results.length);}} }catch(e){fail++;} done++; if(done%5===0||done===rows.length)updateProgress(done,rows.length,fail); } };
    const n=clamp(+$('concurrency').value||10,1,24); await Promise.all(Array.from({length:n},worker)); results.sort((a,b)=>b.score-a.score); renderResults(); $('status').textContent=stopRequested?`중지됨 · ${fmt(done)}개 검사`:`완료 · ${fmt(rows.length)}개 중 ${fmt(results.length)}개 검출`; $('excelBtn').disabled=!results.length;
  }catch(e){$('status').textContent=`오류: ${e.message||e}`;} finally{setRunning(false);stopTimer();}
}
$('scanBtn').addEventListener('click',scanAll); $('stopBtn').addEventListener('click',()=>{stopRequested=true;$('status').textContent='중지 요청...';});

function renderResults(){
  const tb=$('tbody'); if(!results.length){tb.innerHTML='<tr><td colspan="13" class="empty">조건에 맞는 종목이 아직 없습니다.</td></tr>'; $('resultMeta').textContent='검색 결과 0개'; updateValidationSummary(); return;}
  tb.innerHTML=results.map((r,i)=>{
    const b=r.bottom; return `<tr><td>${i+1}</td><td><b>${r.score.toFixed(1)}</b></td><td><b>${esc(r.name)}</b><br><span class="muted">${r.market} · ${r.code}</span></td><td><b>${fmt(r.asOfClose)}</b><br><span class="muted">${isoFromYmd(r.asOf)}</span></td><td>${isoFromYmd(barsDate(r.code,r.gcIdx))}<br><span class="muted">${r.endIdx-r.gcIdx}거래일 전</span></td><td>${pctText(r.rise)}<br><span class="muted">고점 ${fmt(r.peakHigh)}</span></td><td><span class="badge ${r.retr>=50&&r.retr<=80?'good':'warn'}">${r.retr.toFixed(1)}%</span></td><td>${b?`${isoFromYmd(barsDate(r.code,b.b1Idx))}<br>→ ${isoFromYmd(barsDate(r.code,b.b2Idx))}<br><span class="muted">유사도 ${b.similarity.toFixed(2)}%</span>`:'-'}</td><td>MA5 ${fmt(r.ma5)}<br><span class="muted">2차저점 +${r.ma5Near.toFixed(2)}%</span></td><td>${pctText(r.f.r3)} / ${pctText(r.f.r5)}<br>${pctText(r.f.r10)} / ${pctText(r.f.r20)}</td><td><span class="${r.f.maxUp>=5?'pass':''}">${pctText(r.f.maxUp)}</span><br><span class="${r.f.maxDown<=-5?'fail':''}">${pctText(r.f.maxDown)}</span></td><td><a target="_blank" rel="noopener" href="https://finance.naver.com/item/main.naver?code=${r.code}">네이버증권</a></td><td><button class="btn secondary detailBtn" data-code="${r.code}">차트/근거</button></td></tr>`;
  }).join('');
  $('resultMeta').textContent=`${isoFromYmd(results[0].asOf)} 기준 · ${fmt(results.length)}개 · 점수순`; updateValidationSummary();
  document.querySelectorAll('.detailBtn').forEach(b=>b.addEventListener('click',()=>openDetail(b.dataset.code)));
}
function barsDate(code,idx){return historyCache.get(code)?.[idx]?.date||'';}
function updateValidationSummary(){
  const valid=results.filter(r=>Number.isFinite(r.f.r5)||Number.isFinite(r.f.maxUp)); $('vCount').textContent=results.length||'-';
  const mean=k=>{const a=results.map(r=>r.f[k]).filter(Number.isFinite);return a.length?avg(a):NaN;};
  $('vR5').textContent=pctText(mean('r5')); $('vR10').textContent=pctText(mean('r10')); const h5=valid.filter(r=>r.f.hit5!==null),h10=valid.filter(r=>r.f.hit10!==null);
  $('vHit5').textContent=h5.length?`${(h5.filter(r=>r.f.hit5).length/h5.length*100).toFixed(1)}%`:'-'; $('vHit10').textContent=h10.length?`${(h10.filter(r=>r.f.hit10).length/h10.length*100).toFixed(1)}%`:'-'; $('vMdd').textContent=pctText(mean('maxDown'));
}

function detailHtml(r){ const b=r.bottom; const checks=Object.entries(r.checks).map(([k,v])=>`<div><small>${esc(checkLabel(k))}</small><b class="${v?'pass':'fail'}">${v?'통과':'미통과'}</b></div>`).join(''); return `<div class="detail-grid"><div><small>골든크로스</small><b>${isoFromYmd(barsDate(r.code,r.gcIdx))}</b></div><div><small>교차 종가</small><b>${fmt(historyCache.get(r.code)[r.gcIdx].close)}</b></div><div><small>교차 후 고점</small><b>${fmt(r.peakHigh)} (${pctText(r.rise)})</b></div><div><small>조정비율</small><b>${r.retr.toFixed(2)}%</b></div><div><small>1차 MA5 저점</small><b>${b?`${fmt(b.b1)} · ${isoFromYmd(barsDate(r.code,b.b1Idx))}`:'-'}</b></div><div><small>2차 MA5 저점</small><b>${b?`${fmt(b.b2)} · ${isoFromYmd(barsDate(r.code,b.b2Idx))}`:'-'}</b></div><div><small>저점 유사도</small><b>${b?`${b.similarity.toFixed(2)}%`:'-'}</b></div><div><small>저점 사이 반등</small><b>${b?`${b.valleyRebound.toFixed(2)}%`:'-'}</b></div></div><h3>조건 판정</h3><div class="detail-grid">${checks}</div><p><a target="_blank" rel="noopener" href="https://finance.naver.com/item/main.naver?code=${r.code}">네이버증권에서 ${esc(r.name)} 열기</a></p>`; }
function checkLabel(k){return ({gcAge:'골든크로스 경과일',rise:'교차 후 최소 상승',retr:'50~80% 조정 범위',hasBottom:'MA5 저점 2개 존재',bottomSim:'두 저점 가격 유사',gap:'저점 간격',valley:'저점 사이 반등',nearBottom:'지정일이 2차 저점 근처',priceNearMa5:'종가가 MA5 근처',above20:'MA20 조건'}[k]||k);}
function openDetail(code){ const r=results.find(x=>x.code===code); if(!r)return; $('modalTitle').textContent=`${r.name} (${r.code}) · ${isoFromYmd(r.asOf)}`; $('modalBody').innerHTML=detailHtml(r); $('modal').classList.remove('hide'); drawChart(r); }
$('modalClose').addEventListener('click',()=>$('modal').classList.add('hide')); $('modal').addEventListener('click',e=>{if(e.target===$('modal'))$('modal').classList.add('hide');});
function drawChart(r){
  const canvas=$('chart'),ctx=canvas.getContext('2d'),bars=historyCache.get(r.code); if(!ctx||!bars)return; const end=r.endIdx,start=Math.max(20,end-110); const view=bars.slice(start,end+1); const W=canvas.width,H=canvas.height,pad={l:56,r:22,t:28,b:34}; ctx.clearRect(0,0,W,H); ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
  const vals=[]; view.forEach(x=>{vals.push(x.close);if(Number.isFinite(x.ma5))vals.push(x.ma5);if(Number.isFinite(x.ma20))vals.push(x.ma20);}); let lo=Math.min(...vals),hi=Math.max(...vals); const m=(hi-lo)*.08||1;lo-=m;hi+=m;
  const x=i=>pad.l+(i/(view.length-1||1))*(W-pad.l-pad.r), y=v=>pad.t+(hi-v)/(hi-lo)*(H-pad.t-pad.b);
  ctx.strokeStyle='#e5e7eb';ctx.lineWidth=1;ctx.fillStyle='#64748b';ctx.font='12px sans-serif'; for(let k=0;k<=4;k++){const yy=pad.t+k*(H-pad.t-pad.b)/4;ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(W-pad.r,yy);ctx.stroke();const v=hi-k*(hi-lo)/4;ctx.fillText(Math.round(v).toLocaleString(),4,yy+4);}
  const line=(key,color,w)=>{ctx.strokeStyle=color;ctx.lineWidth=w;ctx.beginPath();let begun=false;view.forEach((b,i)=>{const v=b[key];if(!Number.isFinite(v))return;const xx=x(i),yy=y(v);if(!begun){ctx.moveTo(xx,yy);begun=true;}else ctx.lineTo(xx,yy);});ctx.stroke();};
  line('close','#334155',2);line('ma5','#2563eb',3);line('ma20','#f59e0b',2.5);
  const marks=[['GC',r.gcIdx,'#16a34a'],['고점',r.peakIdx,'#dc2626']]; if(r.bottom){marks.push(['1저점',r.bottom.b1Idx,'#7c3aed'],['2저점',r.bottom.b2Idx,'#7c3aed']);}
  marks.forEach(([label,idx,color])=>{if(idx<start||idx>end)return;const xx=x(idx-start);ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(xx,pad.t);ctx.lineTo(xx,H-pad.b);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=color;ctx.fillText(label,Math.min(xx+4,W-60),pad.t+14);});
  ctx.fillStyle='#0f172a';ctx.font='bold 14px sans-serif';ctx.fillText('종가(회색) · MA5(파랑) · MA20(주황)',pad.l,pad.t-8);
}
