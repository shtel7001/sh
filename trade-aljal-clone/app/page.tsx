'use client';

import { FormEvent, MouseEvent, useCallback, useEffect, useRef, useState } from 'react';

type MirrorPayload = {
  ok:true;
  path:string;
  sourceUrl:string;
  title:string;
  html:string;
  fetchedAt:string;
  dataSources:string[];
};

const nav = [
  {label:'홈',path:'/'},
  {label:'브리핑',path:'/briefing'},
  {label:'월간 총괄',path:'/monthly'},
  {label:'품목·지역',path:'/items'},
  {label:'기업규모별',path:'/firmsize'},
  {label:'가이드',path:'/guide'},
  {label:'자료',path:'/sources'},
];

export default function Home() {
  const [path,setPath] = useState('/');
  const [data,setData] = useState<MirrorPayload|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [needAuth,setNeedAuth] = useState(false);
  const [password,setPassword] = useState('');
  const [authError,setAuthError] = useState('');
  const [authBusy,setAuthBusy] = useState(false);
  const articleRef = useRef<HTMLElement|null>(null);

  const load = useCallback(async(target:string) => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/mirror?path='+encodeURIComponent(target),{cache:'no-store'});
      if (r.status === 401) {
        setNeedAuth(true);
        setLoading(false);
        return;
      }
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || '데이터를 불러오지 못했습니다.');
      setData(j);
      setPath(j.path || target);
      setNeedAuth(false);
      window.scrollTo({top:0,behavior:'smooth'});
    } catch(e) {
      setError(e instanceof Error ? e.message : '불러오기 오류');
    } finally {
      setLoading(false);
    }
  },[]);

  useEffect(()=>{ load('/'); },[load]);

  useEffect(()=>{
    const fn = (e:PopStateEvent) => load(String(e.state?.path || '/'));
    window.addEventListener('popstate',fn);
    return ()=>window.removeEventListener('popstate',fn);
  },[load]);

  function navigate(target:string) {
    if (target === path && data) return;
    history.pushState({path:target},'',target==='/'?'/':'/?mirror='+encodeURIComponent(target));
    load(target);
  }

  async function submitAuth(e:FormEvent) {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError('');
    try {
      const r = await fetch('/api/auth/login',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({password})
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || '인증 실패');
      setNeedAuth(false);
      setPassword('');
      await load(path || '/');
    } catch(e) {
      setAuthError(e instanceof Error ? e.message : '인증 실패');
    } finally {
      setAuthBusy(false);
    }
  }

  function onArticleClick(e:MouseEvent<HTMLElement>) {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a[data-trade-path]') as HTMLAnchorElement|null;
    if (anchor) {
      e.preventDefault();
      const next = anchor.dataset.tradePath;
      if (next) navigate(next);
      return;
    }
    const button = target.closest('button');
    if (button && /복사/.test(button.textContent || '')) {
      navigator.clipboard?.writeText(articleRef.current?.innerText || '');
    }
  }

  async function copyPage() {
    await navigator.clipboard?.writeText(articleRef.current?.innerText || '');
  }

  const activeTop = nav.find(x => path === x.path || (x.path !== '/' && path.startsWith(x.path)))?.path || '/';

  return <div className="tf-shell">
    <header className="tf-top">
      <div className="tf-topin">
        <div className="tf-brandrow">
          <div className="tf-brand">
            <div className="tf-mark">K</div>
            <div>
              <div className="tf-title">K-Trade Flow</div>
              <div className="tf-sub">수출 흐름으로 읽는 한국 무역통계 · 개인용 미러 대시보드</div>
            </div>
          </div>
          <div className="tf-live"><span className="tf-dot"/>공식 원자료 동기화</div>
        </div>
        <nav className="tf-nav" aria-label="주요 메뉴">
          {nav.map(item=><button key={item.path} className={activeTop===item.path?'active':''} onClick={()=>navigate(item.path)}>{item.label}</button>)}
        </nav>
      </div>
    </header>

    <main className="tf-body">
      <div className="tf-toolbar">
        <div className="tf-route">
          <strong>{data?.title || '수출입 통계 불러오는 중'}</strong>
          <span>{data ? '동기화 '+new Date(data.fetchedAt).toLocaleString('ko-KR') : '관세청·산업통상부 공개자료 기반'}</span>
        </div>
        <div className="tf-actions">
          <button onClick={()=>load(path)}>새로고침</button>
          <button onClick={copyPage}>화면 복사</button>
          {data?.sourceUrl && <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer">원본 열기 ↗</a>}
        </div>
      </div>

      <section className="tf-frame">
        <div className="tf-accent"/>
        {loading && <div className="tf-loading"><div className="tf-spinner"/>최신 수출입 데이터를 동기화하고 있습니다.</div>}
        {!loading && error && <div className="tf-error">{error}<br/><small>잠시 후 새로고침을 눌러 다시 확인해 주세요.</small></div>}
        {!loading && !error && data && <article ref={articleRef} className="tf-article" onClick={onArticleClick} dangerouslySetInnerHTML={{__html:data.html}}/>}
        {data?.dataSources?.length ? <div className="tf-sourcebar">{data.dataSources.map(x=><span key={x}>{x}</span>)}</div> : null}
      </section>
    </main>

    <div className="tf-foot">원자료 출처를 그대로 유지한 개인용 조회 화면입니다. 잠정치는 발표기관 정정에 따라 바뀔 수 있습니다.</div>

    {needAuth && <div className="tf-auth">
      <form className="tf-authcard" onSubmit={submitAuth}>
        <span className="tf-authbadge">PRIVATE ACCESS</span>
        <h1>1회용 장기 인증</h1>
        <p>기존 개인 인증번호를 한 번 입력하면 이 기기에서 장기간 유지됩니다. 인증 쿠키는 HTTP-only로 저장됩니다.</p>
        <input autoFocus type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="개인 인증번호"/>
        <button disabled={authBusy || !password}>{authBusy?'확인 중…':'인증하고 시작'}</button>
        {authError && <div className="tf-autherr">{authError}</div>}
        <small>브라우저 쿠키를 직접 삭제하거나 기기를 초기화하면 다시 인증해야 합니다.</small>
      </form>
    </div>}
  </div>;
}
