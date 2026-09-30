let backtestSignalRowsV2 = [];
let backtestExportMetaV2 = null;

function futurePointV2(bars,endIdx,n){
  const b=bars?.[endIdx+n];
  const base=bars?.[endIdx]?.close;
  if(!b||!base)return {date:'',close:NaN,ret:NaN};
  return {date:b.date,close:b.close,ret:(b.close/base-1)*100};
}

function extendedFutureMetricsV2(bars,endIdx,forward){
  const base=bars?.[endIdx]?.close;
  if(!base)return {};
  const end=Math.min(bars.length-1,endIdx+forward);
  if(end<=endIdx)return {endDate:'',endClose:NaN,closeReturn:NaN,maxHigh:NaN,maxHighDate:'',maxUp:NaN,minLow:NaN,minLowDate:'',maxDown:NaN,hit5:false,hit5Date:'',hit10:false,hit10Date:''};
  let maxHigh=-Infinity,maxHighDate='',minLow=Infinity,minLowDate='',hit5Date='',hit10Date='';
  for(let i=endIdx+1;i<=end;i++){
    const b=bars[i];
    if(b.high>maxHigh){maxHigh=b.high;maxHighDate=b.date;}
    if(b.low<minLow){minLow=b.low;minLowDate=b.date;}
    if(!hit5Date&&b.high>=base*1.05)hit5Date=b.date;
    if(!hit10Date&&b.high>=base*1.10)hit10Date=b.date;
  }
  const last=bars[end];
  return {
    endDate:last.date,endClose:last.close,closeReturn:(last.close/base-1)*100,
    maxHigh,maxHighDate,maxUp:(maxHigh/base-1)*100,
    minLow,minLowDate,maxDown:(minLow/base-1)*100,
    hit5:!!hit5Date,hit5Date,hit10:!!hit10Date,hit10Date
  };
}

function backtestDetailRowV2(r,rank,forward){
  const bars=historyCache.get(r.code)||[];
  const base=bars[r.endIdx]||{};
  const gc=bars[r.gcIdx]||{};
  const p3=futurePointV2(bars,r.endIdx,3);
  const p5=futurePointV2(bars,r.endIdx,5);
  const p10=futurePointV2(bars,r.endIdx,10);
  const p20=futurePointV2(bars,r.endIdx,20);
  const ext=extendedFutureMetricsV2(bars,r.endIdx,forward);
  return {
    '기준일':isoFromYmd(r.asOf),
    '기준일내 순위':rank,
    '점수':r.score,
    '단계':stageText(r),
    '시장':r.market,
    '종목명':r.name,
    '종목코드':r.code,
    '기준일 종가':r.asOfClose,
    '기준일 거래량':base.volume,
    '기준일 MA5':r.ma5,
    '기준일 MA20':r.ma20,
    '골든크로스일':isoFromYmd(gc.date||barsDate(r.code,r.gcIdx)),
    '골든크로스 종가':gc.close,
    '골든크로스 경과일':r.gcAge,
    '고점일':isoFromYmd(barsDate(r.code,r.peakIdx)),
    '고점 가격':r.peakHigh,
    '고점후 경과일':r.peakAge,
    '교차→고점 상승률(%)':r.rise,
    '현재 조정비율(%)':r.retr,
    'MA5 1저점일':isoFromYmd(barsDate(r.code,r.bottomIdx)),
    'MA5 1저점':r.bottomMa5,
    '1저점 경과일':r.bottomAge,
    'MA5 하락 연속일':r.downCount,
    '현재가/1저점 거리(%)':r.priceBottomDist,
    '현재MA5/1저점 거리(%)':r.ma5BottomDist,
    'MA5 저점대비 반등률(%)':r.turnPct,
    '3일후 날짜':isoFromYmd(p3.date),
    '3일후 종가':p3.close,
    '3일 수익률(%)':p3.ret,
    '5일후 날짜':isoFromYmd(p5.date),
    '5일후 종가':p5.close,
    '5일 수익률(%)':p5.ret,
    '10일후 날짜':isoFromYmd(p10.date),
    '10일후 종가':p10.close,
    '10일 수익률(%)':p10.ret,
    '20일후 날짜':isoFromYmd(p20.date),
    '20일후 종가':p20.close,
    '20일 수익률(%)':p20.ret,
    '성과확인 거래일':forward,
    '성과확인 종료일':isoFromYmd(ext.endDate),
    '성과확인 종료종가':ext.endClose,
    '성과확인 종가수익률(%)':ext.closeReturn,
    '기간내 최고가':ext.maxHigh,
    '기간내 최고가일':isoFromYmd(ext.maxHighDate),
    '기간내 최고상승률(%)':ext.maxUp,
    '기간내 최저가':ext.minLow,
    '기간내 최저가일':isoFromYmd(ext.minLowDate),
    '기간내 최대낙폭(%)':ext.maxDown,
    '+5% 도달':ext.hit5?'Y':'N',
    '+5% 최초도달일':isoFromYmd(ext.hit5Date),
    '+10% 도달':ext.hit10?'Y':'N',
    '+10% 최초도달일':isoFromYmd(ext.hit10Date),
    '네이버증권':`https://finance.naver.com/item/main.naver?code=${r.code}`
  };
}

function styleSheetV2(ws,widths){
  ws['!freeze']={xSplit:0,ySplit:1,topLeftCell:'A2',activePane:'bottomLeft',state:'frozen'};
  if(ws['!ref'])ws['!autofilter']={ref:ws['!ref']};
  ws['!cols']=widths||Array.from({length:60},()=>({wch:14}));
}

function exportBacktestXlsxV2(){
  if(typeof XLSX==='undefined')return alert('Excel 모듈을 불러오지 못했습니다.');
  if(!backtestSignalRowsV2.length)return alert('먼저 기간 백테스트를 실행해 주세요.');
  const wb=XLSX.utils.book_new();
  const detailWs=XLSX.utils.json_to_sheet(backtestSignalRowsV2);
  styleSheetV2(detailWs,[{wch:12},{wch:10},{wch:8},{wch:12},{wch:9},{wch:18},{wch:11},...Array.from({length:44},()=>({wch:15})),{wch:48}]);
  XLSX.utils.book_append_sheet(wb,detailWs,'백테스트_종목상세');

  const summaryData=backtestRows.map(r=>({
    '기준일':isoFromYmd(r.date),'검출 수':r.n,'평균 종가수익률(%)':r.close,'평균 기간내 최고상승률(%)':r.maxUp,
    '+5% 도달률(%)':r.hit5,'+10% 도달률(%)':r.hit10,'평균 최대낙폭(%)':r.down
  }));
  const summaryWs=XLSX.utils.json_to_sheet(summaryData);
  styleSheetV2(summaryWs,[{wch:13},{wch:10},{wch:22},{wch:26},{wch:17},{wch:18},{wch:20}]);
  XLSX.utils.book_append_sheet(wb,summaryWs,'날짜별_요약');

  const m=backtestExportMetaV2||{};
  const settings=[
    ['항목','값'],
    ['검증 시작일',m.start||$('btStart').value],['검증 종료일',m.end||$('btEnd').value],['검사 간격(거래일)',m.step??$('btStep').value],
    ['성과 확인(거래일)',m.forward??$('btForward').value],['하루 최대 신호 수',m.topN??$('btTopN').value],['시장',$('market').value],['신호 단계',$('stageMode').value],
    ['GC 최소 경과일',$('gcMinDays').value],['GC 최대 경과일',$('gcMaxDays').value],['교차 후 최소 상승률(%)',$('minRise').value],
    ['고점 후 최소 경과일',$('peakMinAge').value],['고점 후 최대 경과일',$('peakMaxAge').value],['조정비율 하단(%)',$('retrMin').value],['조정비율 상단(%)',$('retrMax').value],
    ['1저점 최근성(거래일)',$('bottomRecentDays').value],['MA5 하락 최소 연속일',$('ma5DownDays').value],['현재가/1저점 MA5 허용(%)',$('priceBottomTol').value],
    ['현재 MA5/1저점 허용(%)',$('ma5BottomTol').value],['반등확인 최소 MA5 상승(%)',$('turnMinPct').value],['이전 저점 반등 판정(%)',$('priorBounceReject').value]
  ];
  const settingsWs=XLSX.utils.aoa_to_sheet(settings);
  settingsWs['!cols']=[{wch:28},{wch:24}];
  XLSX.utils.book_append_sheet(wb,settingsWs,'검색조건');

  const filename=`GC_MA5_1저점_백테스트_종목상세_${m.start||$('btStart').value}_${m.end||$('btEnd').value}.xlsx`;
  XLSX.writeFile(wb,filename,{bookType:'xlsx',compression:true});
}

async function runBacktestV2(){
  if(running)return;
  stopRequested=false;
  backtestSignalRowsV2=[];
  backtestExportMetaV2=null;
  const exportBtn=$('btExcelBtn');
  if(exportBtn)exportBtn.disabled=true;
  try{
    const c=getCfg();validateCfg(c);
    const rows=await loadUniverse();
    const s=$('btStart').value,e=$('btEnd').value;
    if(!s||!e||s>e)throw new Error('검증 시작일과 종료일을 확인하세요.');
    setRunning(true);startTimer();
    await ensureAllHistories(rows);
    if(stopRequested)return;
    const dates=referenceDates(rows,s,e);
    const step=clamp(+$('btStep').value||1,1,30);
    const forward=clamp(+$('btForward').value||20,3,40);
    const topN=clamp(+$('btTopN').value||30,1,100);
    const picked=dates.filter((_,i)=>i%step===0);
    backtestRows=[];
    let totalSignals=[];
    for(let di=0;di<picked.length;di++){
      if(stopRequested)break;
      const date=picked[di],signals=[];
      for(const stock of rows){
        const bars=historyCache.get(stock.code);if(!bars)continue;
        const endIdx=endIndexForDate(bars,date);if(endIdx<35)continue;
        const a=analyzeAt(bars,endIdx,c,false);
        if(a)signals.push(makeResult(stock,bars,a));
      }
      signals.sort((a,b)=>b.score-a.score);
      const chosen=signals.slice(0,topN);
      chosen.forEach((r,i)=>backtestSignalRowsV2.push(backtestDetailRowV2(r,i+1,forward)));
      totalSignals.push(...chosen);
      const sm=summaryForSignals(chosen,forward);
      backtestRows.push({date,...sm});
      $('status').textContent=`백테스트 ${di+1}/${picked.length} · ${isoFromYmd(date)} · 신호 ${chosen.length}`;
      $('bar').style.width=`${picked.length?(di+1)/picked.length*100:0}%`;
      $('progressTxt').textContent=`${di+1} / ${picked.length}`;
      if(di%2===0)await sleep(0);
    }
    renderBacktest();
    const all=summaryForSignals(totalSignals,forward);
    $('backtestSummary').innerHTML=`<b>전체 ${fmt(totalSignals.length)}개 신호 인스턴스</b> · 평균 ${forward}거래일 종가수익 <b>${pctText(all.close)}</b> · 평균 기간내 최고상승 <b>${pctText(all.maxUp)}</b> · +5% 도달률 <b>${Number.isFinite(all.hit5)?all.hit5.toFixed(1)+'%':'-'}</b> · +10% 도달률 <b>${Number.isFinite(all.hit10)?all.hit10.toFixed(1)+'%':'-'}</b> · 평균 최대낙폭 <b>${pctText(all.down)}</b><br><span class="muted">같은 종목이 여러 기준일에 반복 검출되면 각각 하나의 신호로 집계합니다. 하루 신호는 점수 상위 ${topN}개까지만 사용합니다. <b>아래 Excel 저장 버튼에서 각 종목의 3·5·10·20일 수익률과 기간 최고/최저까지 모두 저장할 수 있습니다.</b></span>`;
    backtestExportMetaV2={start:s,end:e,step,forward,topN};
    if(exportBtn)exportBtn.disabled=!backtestSignalRowsV2.length;
    $('status').textContent=stopRequested?'백테스트 중지됨':'백테스트 완료 · 상세 Excel 저장 가능';
  }catch(e){
    $('status').textContent=`백테스트 오류: ${e.message||e}`;
  }finally{
    if(exportBtn&&backtestSignalRowsV2.length)exportBtn.disabled=false;
    setRunning(false);stopTimer();
  }
}

(function installBacktestDetailExportV2(){
  const stepInput=$('btStep');
  if(stepInput){
    stepInput.min='1';
    stepInput.max='30';
    stepInput.step='1';
    stepInput.value='1';
  }

  const oldBtn=$('backtestBtn');
  if(!oldBtn)return;
  const newBtn=oldBtn.cloneNode(true);
  oldBtn.replaceWith(newBtn);
  newBtn.addEventListener('click',runBacktestV2);

  const exportBtn=document.createElement('button');
  exportBtn.id='btExcelBtn';
  exportBtn.className='btn good';
  exportBtn.textContent='백테스트 종목상세 Excel .xlsx 저장';
  exportBtn.disabled=true;
  newBtn.parentElement.appendChild(exportBtn);
  exportBtn.addEventListener('click',exportBacktestXlsxV2);
})();
