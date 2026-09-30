const $ = s => document.querySelector(s);
const state = { data:[], favorites:new Set(JSON.parse(localStorage.getItem('themeFavorites')||'[]')), stockFavorites:new Set(JSON.parse(localStorage.getItem('stockFavorites')||'[]')) };

async function checkSession(){
  try{const r=await fetch('/api/theme-value-radar/session',{cache:'no-store'});const j=await r.json();return !!j.ok}catch(_){return false}
}
async function init(){
  if(await checkSession()){showApp()}else{$('#auth').classList.remove('hidden')}
}
function showApp(){ $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden'); updateFavoriteCount(); }

$('#authForm').addEventListener('submit',async e=>{
  e.preventDefault(); $('#authMsg').textContent='인증 중...';
  const r=await fetch('/api/theme-value-radar/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('#code').value.trim()})});
  const j=await r.json().catch(()=>({}));
  if(r.ok&&j.ok){localStorage.setItem('themeRadarAuthorized','1');showApp();$('#authMsg').textContent='';}else{$('#authMsg').textContent=j.message||'인증에 실패했습니다.'}
});

function fmt(n,d=1){return Number.isFinite(n)?Number(n).toLocaleString('ko-KR',{maximumFractionDigits:d}):'-'}
function scoreClass(n){return n>=78?'high':n>=62?'mid':'low'}
function verdict(t){const ma=+$('#maxAlien').value,min=+$('#minOutlook').value;if(t.outlook>=min&&t.alienation<=ma&&t.reversal>=44)return ['저평가 후보','good'];if(t.alienation>90)return ['고점 근접','hot'];return ['관찰','watch']}
function naver(code){return `https://finance.naver.com/item/main.naver?code=${code}`}
function render(){
  const q=$('#search').value.trim().toLowerCase(); const ma=+$('#maxAlien').value,min=+$('#minOutlook').value;
  const list=state.data.filter(t=>!q||t.name.toLowerCase().includes(q)||t.stocks.some(s=>s[1].toLowerCase().includes(q))||t.thesis.toLowerCase().includes(q));
  $('#themeCount').textContent=state.data.length||'-'; $('#candidateCount').textContent=state.data.filter(t=>t.outlook>=min&&t.alienation<=ma&&t.reversal>=44).length;
  $('#themeRows').innerHTML=list.length?list.map((t,i)=>{const v=verdict(t);return `<tr>
    <td><b>${i+1}</b></td><td><button class="star ${state.favorites.has(t.id)?'on':''}" data-theme="${t.id}">★</button></td>
    <td class="theme-name">${t.name}</td><td class="score ${scoreClass(t.opportunity)}">${fmt(t.opportunity)}</td><td class="score ${scoreClass(t.outlook)}">${fmt(t.outlook)}</td>
    <td class="score ${t.alienation<=ma?'high':t.alienation>90?'low':'mid'}">${fmt(t.alienation)}</td><td>${fmt(t.drawdown)}%</td><td class="score ${t.momentum>=0?'high':'low'}">${t.momentum>=0?'+':''}${fmt(t.momentum)}%</td>
    <td>${fmt(t.newsScore)}</td><td><span class="badge ${v[1]}">${v[0]}</span></td></tr>`}).join(''):'<tr><td colspan="10" class="empty">조건에 맞는 테마가 없습니다.</td></tr>';

  $('#detail').innerHTML=list.map(t=>{
    const v=verdict(t); const news=(t.newsItems||[]).slice(0,4);
    return `<article class="theme-card"><div class="theme-card-head"><div class="row"><div><span class="eyebrow">${v[0]}</span><h3>${t.name}</h3></div><div class="bigscore">${fmt(t.opportunity)}</div></div><p>${t.thesis}</p>
      <div class="subscores"><div><span>전망</span><b>${fmt(t.outlook)}</b></div><div><span>소외지수</span><b>${fmt(t.alienation)}</b></div><div><span>최근뉴스</span><b>${fmt(t.newsScore)}</b></div><div><span>반등신호</span><b>${fmt(t.reversal)}</b></div></div></div>
      <div class="stock-list">${t.stockData.map(s=>`<div class="stock-row"><button class="star ${state.stockFavorites.has(s.code)?'on':''}" data-stock="${s.code}">★</button><div><a href="${naver(s.code)}" target="_blank" rel="noopener">${s.name}</a><div class="tier">${s.tier} · ${s.code}</div></div><div class="price">${s.error?'-':fmt(s.current,0)}</div><div class="move ${!s.error&&s.mom20>=0?'score high':'score low'}">${s.error?'-':(s.mom20>=0?'+':'')+fmt(s.mom20)+'%'}</div><div class="tier">${s.error?'데이터없음':'고점대비 '+fmt(100-s.pos)+'%'}</div></div>`).join('')}</div>
      <div class="news-list"><h4>최근 7일 뉴스 신호</h4>${news.length?news.map(n=>`<a href="${n.link}" target="_blank" rel="noopener">${n.title}</a>`).join(''):'<a>뉴스 피드 연결 실패 또는 결과 없음</a>'}</div></article>`
  }).join('');

  document.querySelectorAll('[data-theme]').forEach(b=>b.onclick=()=>toggleTheme(b.dataset.theme));
  document.querySelectorAll('[data-stock]').forEach(b=>b.onclick=()=>toggleStock(b.dataset.stock));
}
function toggleTheme(id){state.favorites.has(id)?state.favorites.delete(id):state.favorites.add(id);localStorage.setItem('themeFavorites',JSON.stringify([...state.favorites]));updateFavoriteCount()}
function toggleStock(id){state.stockFavorites.has(id)?state.stockFavorites.delete(id):state.stockFavorites.add(id);localStorage.setItem('stockFavorites',JSON.stringify([...state.stockFavorites]));render()}
function updateFavoriteCount(){if($('#favoriteCount'))$('#favoriteCount').textContent=state.favorites.size}

$('#runBtn').addEventListener('click',async()=>{
  const btn=$('#runBtn'); btn.disabled=true; btn.textContent='분석 중…';
  try{
    const r=await fetch('/api/theme-value-radar/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lookback:+$('#lookback').value})});
    if(r.status===401){location.reload();return}
    const j=await r.json(); if(!j.ok)throw new Error(j.message||'분석 실패');
    state.data=j.results; $('#asOf').textContent=new Date(j.asOf).toLocaleString('ko-KR'); $('#excelBtn').disabled=false; render();
  }catch(e){alert('분석 중 오류가 발생했습니다. 잠시 후 다시 실행해 주세요.\n'+e.message)}finally{btn.disabled=false;btn.textContent='시장·뉴스 분석 실행'}
});

['lookback','maxAlien','minOutlook'].forEach(id=>{$('#'+id).addEventListener('input',()=>{if(id==='lookback')$('#lookbackVal').textContent=$('#lookback').value+'일';if(id==='maxAlien')$('#maxAlienVal').textContent=$('#maxAlien').value;if(id==='minOutlook')$('#minOutlookVal').textContent=$('#minOutlook').value;if(state.data.length)render()})});
$('#search').addEventListener('input',()=>state.data.length&&render());

$('#excelBtn').addEventListener('click',()=>{
  if(!state.data.length)return;
  const themeRows=state.data.map((t,i)=>({순위:i+1,관심테마:state.favorites.has(t.id)?'Y':'',테마:t.name,매수기회점수:+t.opportunity.toFixed(1),전망점수:+t.outlook.toFixed(1),소외지수:+t.alienation.toFixed(1),고점대비낙폭:+t.drawdown.toFixed(1),20일등락률:+t.momentum.toFixed(1),뉴스점수:+t.newsScore.toFixed(1),판정:verdict(t)[0],핵심논리:t.thesis}));
  const stockRows=state.data.flatMap(t=>t.stockData.map(s=>({테마:t.name,관심종목:state.stockFavorites.has(s.code)?'Y':'',종목:s.name,코드:s.code,구분:s.tier,현재가:s.error?'':s.current,20일등락률:s.error?'':+s.mom20.toFixed(1),고점대비낙폭:s.error?'':+(100-s.pos).toFixed(1),네이버증권:naver(s.code)})));
  const newsRows=state.data.flatMap(t=>(t.newsItems||[]).map(n=>({테마:t.name,뉴스:n.title,게시일:n.pubDate,링크:n.link})));
  if(!window.XLSX){alert('Excel 모듈을 불러오지 못했습니다. 네트워크 상태를 확인해 주세요.');return}
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(themeRows),'테마순위'); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(stockRows),'종목'); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(newsRows),'뉴스');
  XLSX.writeFile(wb,`Theme_Value_Radar_${new Date().toISOString().slice(0,10)}.xlsx`);
});

init();
