(function(){
  'use strict';

  var $ = function(s){ return document.querySelector(s); };
  var state = { data: [], favorites: new Set(), stockFavorites: new Set() };

  function storageGet(key){ try { return window.localStorage.getItem(key) || ''; } catch(e){ return ''; } }
  function storageSet(key,value){ try { window.localStorage.setItem(key,value); } catch(e){} }
  function storageRemove(key){ try { window.localStorage.removeItem(key); } catch(e){} }
  function readSet(key){
    try {
      var raw = storageGet(key);
      if(!raw) return new Set();
      var parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch(e){
      storageRemove(key);
      return new Set();
    }
  }
  function saveSet(key,set){ storageSet(key, JSON.stringify(Array.from(set))); }
  function authToken(){ return storageGet('themeRadarToken'); }
  function authHeaders(json){
    var h = {};
    if(json) h['Content-Type'] = 'application/json';
    var token = authToken();
    if(token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  state.favorites = readSet('themeFavorites');
  state.stockFavorites = readSet('stockFavorites');

  function showApp(){
    var auth = $('#auth');
    var app = $('#app');
    if(auth) auth.classList.add('hidden');
    if(app) app.classList.remove('hidden');
    updateFavoriteCount();
  }

  function checkSession(){
    return fetch('/api/theme-value-radar/session', {
      method:'GET', credentials:'include', cache:'no-store', headers:authHeaders(false)
    }).then(function(r){ return r.json().catch(function(){ return {}; }); })
      .then(function(j){ if(j && j.ok){ showApp(); return true; } return false; })
      .catch(function(){ return false; });
  }

  function fmt(n,d){
    if(d === undefined) d = 1;
    return Number.isFinite(Number(n)) ? Number(n).toLocaleString('ko-KR',{maximumFractionDigits:d}) : '-';
  }
  function scoreClass(n){ return n>=78 ? 'high' : (n>=62 ? 'mid' : 'low'); }
  function verdict(t){
    var ma = Number($('#maxAlien').value), min = Number($('#minOutlook').value);
    if(t.outlook>=min && t.alienation<=ma && t.reversal>=44) return ['저평가 후보','good'];
    if(t.alienation>90) return ['고점 근접','hot'];
    return ['관찰','watch'];
  }
  function naver(code){ return 'https://finance.naver.com/item/main.naver?code=' + encodeURIComponent(code); }

  function render(){
    var searchEl = $('#search');
    var q = searchEl ? searchEl.value.trim().toLowerCase() : '';
    var ma = Number($('#maxAlien').value), min = Number($('#minOutlook').value);
    var list = state.data.filter(function(t){
      if(!q) return true;
      if(String(t.name||'').toLowerCase().indexOf(q)>=0) return true;
      if(String(t.thesis||'').toLowerCase().indexOf(q)>=0) return true;
      return (t.stocks||[]).some(function(s){ return String(s[1]||'').toLowerCase().indexOf(q)>=0; });
    });

    $('#themeCount').textContent = state.data.length || '-';
    $('#candidateCount').textContent = state.data.filter(function(t){ return t.outlook>=min && t.alienation<=ma && t.reversal>=44; }).length;

    var rows = list.map(function(t,i){
      var v = verdict(t);
      return '<tr>'+
        '<td><b>'+(i+1)+'</b></td>'+
        '<td><button class="star '+(state.favorites.has(t.id)?'on':'')+'" data-theme="'+t.id+'">★</button></td>'+
        '<td class="theme-name">'+t.name+'</td>'+
        '<td class="score '+scoreClass(t.opportunity)+'">'+fmt(t.opportunity)+'</td>'+
        '<td class="score '+scoreClass(t.outlook)+'">'+fmt(t.outlook)+'</td>'+
        '<td class="score '+(t.alienation<=ma?'high':(t.alienation>90?'low':'mid'))+'">'+fmt(t.alienation)+'</td>'+
        '<td>'+fmt(t.drawdown)+'%</td>'+
        '<td class="score '+(t.momentum>=0?'high':'low')+'">'+(t.momentum>=0?'+':'')+fmt(t.momentum)+'%</td>'+
        '<td>'+fmt(t.newsScore)+'</td>'+
        '<td><span class="badge '+v[1]+'">'+v[0]+'</span></td>'+
      '</tr>';
    }).join('');
    $('#themeRows').innerHTML = rows || '<tr><td colspan="10" class="empty">조건에 맞는 테마가 없습니다.</td></tr>';

    $('#detail').innerHTML = list.map(function(t){
      var v = verdict(t);
      var news = (t.newsItems||[]).slice(0,4);
      var stocks = (t.stockData||[]).map(function(s){
        return '<div class="stock-row">'+
          '<button class="star '+(state.stockFavorites.has(s.code)?'on':'')+'" data-stock="'+s.code+'">★</button>'+
          '<div><a href="'+naver(s.code)+'" target="_blank" rel="noopener">'+s.name+'</a><div class="tier">'+s.tier+' · '+s.code+'</div></div>'+
          '<div class="price">'+(s.error?'-':fmt(s.current,0))+'</div>'+
          '<div class="move '+(!s.error&&s.mom20>=0?'score high':'score low')+'">'+(s.error?'-':((s.mom20>=0?'+':'')+fmt(s.mom20)+'%'))+'</div>'+
          '<div class="tier">'+(s.error?'데이터없음':'고점대비 '+fmt(100-s.pos)+'%')+'</div>'+
        '</div>';
      }).join('');
      var newsHtml = news.length ? news.map(function(n){ return '<a href="'+n.link+'" target="_blank" rel="noopener">'+n.title+'</a>'; }).join('') : '<a>뉴스 피드 연결 실패 또는 결과 없음</a>';
      return '<article class="theme-card">'+
        '<div class="theme-card-head"><div class="row"><div><span class="eyebrow">'+v[0]+'</span><h3>'+t.name+'</h3></div><div class="bigscore">'+fmt(t.opportunity)+'</div></div><p>'+t.thesis+'</p>'+
        '<div class="subscores"><div><span>전망</span><b>'+fmt(t.outlook)+'</b></div><div><span>소외지수</span><b>'+fmt(t.alienation)+'</b></div><div><span>최근뉴스</span><b>'+fmt(t.newsScore)+'</b></div><div><span>반등신호</span><b>'+fmt(t.reversal)+'</b></div></div></div>'+
        '<div class="stock-list">'+stocks+'</div><div class="news-list"><h4>최근 7일 뉴스 신호</h4>'+newsHtml+'</div></article>';
    }).join('');

    document.querySelectorAll('[data-theme]').forEach(function(b){ b.onclick=function(){ toggleTheme(b.getAttribute('data-theme')); }; });
    document.querySelectorAll('[data-stock]').forEach(function(b){ b.onclick=function(){ toggleStock(b.getAttribute('data-stock')); }; });
  }

  function toggleTheme(id){
    if(state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
    saveSet('themeFavorites',state.favorites); updateFavoriteCount(); render();
  }
  function toggleStock(id){
    if(state.stockFavorites.has(id)) state.stockFavorites.delete(id); else state.stockFavorites.add(id);
    saveSet('stockFavorites',state.stockFavorites); render();
  }
  function updateFavoriteCount(){ var e=$('#favoriteCount'); if(e) e.textContent=state.favorites.size; }

  function runAnalysis(){
    var btn = $('#runBtn');
    if(!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '분석 중…';

    fetch('/api/theme-value-radar/analyze', {
      method:'POST', credentials:'include', cache:'no-store', headers:authHeaders(true),
      body:JSON.stringify({lookback:Number($('#lookback').value)||240})
    }).then(function(r){
      if(r.status===401){
        storageRemove('themeRadarToken'); storageRemove('themeRadarAuthorized');
        throw new Error('인증이 만료되었습니다. 새로고침 후 다시 인증해 주세요.');
      }
      return r.json().catch(function(){ throw new Error('서버 응답을 읽지 못했습니다.'); });
    }).then(function(j){
      if(!j || !j.ok) throw new Error((j && j.message) || '분석 실패');
      state.data = Array.isArray(j.results) ? j.results : [];
      $('#asOf').textContent = j.asOf ? new Date(j.asOf).toLocaleString('ko-KR') : new Date().toLocaleString('ko-KR');
      $('#excelBtn').disabled = state.data.length===0;
      render();
    }).catch(function(e){
      alert('분석 중 오류가 발생했습니다.\n'+(e && e.message ? e.message : String(e)));
    }).finally(function(){
      btn.disabled = false;
      btn.textContent = '시장·뉴스 분석 실행';
    });
  }

  var runBtn = $('#runBtn');
  if(runBtn){
    runBtn.addEventListener('click', function(e){ e.preventDefault(); runAnalysis(); });
    runBtn.onclick = function(e){ e.preventDefault(); runAnalysis(); };
  }

  ['lookback','maxAlien','minOutlook'].forEach(function(id){
    var el=$('#'+id); if(!el) return;
    el.addEventListener('input',function(){
      if(id==='lookback') $('#lookbackVal').textContent=el.value+'일';
      if(id==='maxAlien') $('#maxAlienVal').textContent=el.value;
      if(id==='minOutlook') $('#minOutlookVal').textContent=el.value;
      if(state.data.length) render();
    });
  });
  var search=$('#search'); if(search) search.addEventListener('input',function(){ if(state.data.length) render(); });

  var excelBtn=$('#excelBtn');
  if(excelBtn) excelBtn.addEventListener('click',function(){
    if(!state.data.length) return;
    if(!window.XLSX){ alert('Excel 모듈을 불러오지 못했습니다. 네트워크 상태를 확인해 주세요.'); return; }
    var themeRows=state.data.map(function(t,i){ return {
      '순위':i+1,'관심테마':state.favorites.has(t.id)?'Y':'','테마':t.name,
      '매수기회점수':Number(t.opportunity.toFixed(1)),'전망점수':Number(t.outlook.toFixed(1)),
      '소외지수':Number(t.alienation.toFixed(1)),'고점대비낙폭':Number(t.drawdown.toFixed(1)),
      '20일등락률':Number(t.momentum.toFixed(1)),'뉴스점수':Number(t.newsScore.toFixed(1)),
      '판정':verdict(t)[0],'핵심논리':t.thesis
    }; });
    var stockRows=[];
    state.data.forEach(function(t){ (t.stockData||[]).forEach(function(s){ stockRows.push({
      '테마':t.name,'관심종목':state.stockFavorites.has(s.code)?'Y':'','종목':s.name,'코드':s.code,'구분':s.tier,
      '현재가':s.error?'':s.current,'20일등락률':s.error?'':Number(s.mom20.toFixed(1)),
      '고점대비낙폭':s.error?'':Number((100-s.pos).toFixed(1)),'네이버증권':naver(s.code)
    }); }); });
    var newsRows=[];
    state.data.forEach(function(t){ (t.newsItems||[]).forEach(function(n){ newsRows.push({'테마':t.name,'뉴스':n.title,'게시일':n.pubDate,'링크':n.link}); }); });
    var wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(themeRows),'테마순위');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(stockRows),'종목');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(newsRows),'뉴스');
    XLSX.writeFile(wb,'Theme_Value_Radar_'+new Date().toISOString().slice(0,10)+'.xlsx');
  });

  checkSession();
  window.ThemeValueRadarRun = runAnalysis;
})();
