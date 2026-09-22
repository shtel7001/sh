'use client';

import { useMemo, useRef, useState } from 'react';

type UniverseStock = {
  rank: number;
  name: string;
  code: string;
  market: 'KOSPI';
  currentPrice: number | null;
  marketCap: number | null;
};

type NewsItem = { title: string; link: string; publishedAt: string | null };
type Spike = { date: string; pct: number; preNews: 'YES' | 'NO' | 'UNKNOWN'; leadDays: number | null; headline: string | null };
type RadarRow = UniverseStock & {
  ok: boolean;
  error?: string;
  latestDate?: string;
  close?: number;
  latestChangePct?: number;
  volumeRatio?: number;
  momentum3Pct?: number;
  momentum5Pct?: number;
  ma5?: number;
  ma20?: number;
  spikeCount: number;
  spikes: Spike[];
  baseScore: number;
  score: number;
  reasons: string[];
  newsStatus: 'OK' | 'SKIPPED' | 'ERROR';
  newsSource?: string;
  recentNewsCount: number;
  latestNews: NewsItem[];
};

type Stage = { state: 'idle' | 'running' | 'done' | 'failed'; count: number; message?: string };

const STAGES = 10;
const CHUNK = 50;
const fmt = (n?: number | null) => n == null || !Number.isFinite(n) ? '-' : Math.round(n).toLocaleString('ko-KR');
const pct = (n?: number | null) => n == null || !Number.isFinite(n) ? '-' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function capLabel(v?: number | null) {
  if (v == null || !Number.isFinite(v)) return '-';
  if (v >= 100000) return `${(v / 10000).toFixed(1)}조`;
  return `${Math.round(v).toLocaleString('ko-KR')}억`;
}

function naverStock(code: string) {
  return `https://finance.naver.com/item/main.naver?code=${code}`;
}
function naverNews(name: string) {
  return `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(name)}`;
}
function yahoo(code: string) {
  return `https://finance.yahoo.com/quote/${code}.KS/`;
}

export default function Dashboard() {
  const [rows, setRows] = useState<RadarRow[]>([]);
  const [stages, setStages] = useState<Stage[]>(Array.from({ length: STAGES }, () => ({ state: 'idle', count: 0 })));
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('대기 중 · KOSPI 시가총액 상위 500종목을 50개씩 10단계로 분석합니다.');
  const [query, setQuery] = useState('');
  const [lookbackDays, setLookbackDays] = useState(60);
  const [spikePct, setSpikePct] = useState(5);
  const [newsLeadDays, setNewsLeadDays] = useState(3);
  const [candidateMin, setCandidateMin] = useState(55);
  const [sortMode, setSortMode] = useState<'score' | 'spike' | 'volume'>('score');
  const universeRef = useRef<UniverseStock[]>([]);
  const abortRef = useRef(false);

  const completed = rows.filter((r) => r.ok).length;
  const surged = rows.filter((r) => r.ok && r.spikeCount > 0).length;
  const candidates = rows.filter((r) => r.ok && r.score >= candidateMin && (r.latestChangePct ?? 0) < spikePct).length;
  const failedStages = stages.map((s, i) => s.state === 'failed' ? i + 1 : null).filter(Boolean) as number[];

  const candidateRows = useMemo(() => rows
    .filter((r) => r.ok && r.score >= candidateMin && (r.latestChangePct ?? 0) < spikePct)
    .sort((a, b) => b.score - a.score || (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0)), [rows, candidateMin, spikePct]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = rows.filter((r) => !q || r.name.toLowerCase().includes(q) || r.code.includes(q));
    out.sort((a, b) => {
      if (sortMode === 'spike') return b.spikeCount - a.spikeCount || b.score - a.score;
      if (sortMode === 'volume') return (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0);
      return b.score - a.score || b.spikeCount - a.spikeCount;
    });
    return out;
  }, [rows, query, sortMode]);

  function updateStage(i: number, patch: Partial<Stage>) {
    setStages((prev) => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }

  async function fetchUniverse() {
    setStatus('네이버 금융 기준 KOSPI 시가총액 상위 종목을 수집하는 중…');
    const r = await fetch('/api/radar/universe', { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || 'KOSPI 500 종목목록 수집 실패');
    const stocks = (j.stocks || []) as UniverseStock[];
    if (stocks.length < 400) throw new Error(`종목목록이 ${stocks.length}개만 수집되었습니다.`);
    universeRef.current = stocks.slice(0, 500);
    return universeRef.current;
  }

  async function runStage(stageIndex: number, stocks: UniverseStock[], retry = 0) {
    if (abortRef.current) return;
    const slice = stocks.slice(stageIndex * CHUNK, (stageIndex + 1) * CHUNK);
    if (!slice.length) {
      updateStage(stageIndex, { state: 'done', count: 0, message: '대상 없음' });
      return;
    }
    updateStage(stageIndex, { state: 'running', count: 0, message: retry ? `재시도 ${retry}/2` : '분석 중' });
    try {
      const r = await fetch('/api/radar/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stocks: slice, lookbackDays, spikePct, newsLeadDays }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      const got = (j.rows || []) as RadarRow[];
      setRows((prev) => {
        const map = new Map(prev.map((x) => [x.code, x]));
        got.forEach((x) => map.set(x.code, x));
        const merged = Array.from(map.values());
        try { sessionStorage.setItem('kospi-news-radar-v2-results', JSON.stringify(merged)); } catch {}
        return merged;
      });
      updateStage(stageIndex, { state: 'done', count: got.filter((x) => x.ok).length, message: `${j.meta?.elapsedMs ? (j.meta.elapsedMs / 1000).toFixed(1) : '?'}초` });
    } catch (e) {
      if (retry < 2 && !abortRef.current) {
        updateStage(stageIndex, { state: 'running', message: `오류 · ${retry + 1}차 재시도 대기` });
        await wait(1200 * (retry + 1));
        return runStage(stageIndex, stocks, retry + 1);
      }
      updateStage(stageIndex, { state: 'failed', count: 0, message: e instanceof Error ? e.message : '분석 실패' });
    }
  }

  async function start(fullReset = true) {
    if (running) return;
    abortRef.current = false;
    setRunning(true);
    if (fullReset) {
      setRows([]);
      setStages(Array.from({ length: STAGES }, () => ({ state: 'idle', count: 0 })));
      try { sessionStorage.removeItem('kospi-news-radar-v2-results'); } catch {}
    }
    try {
      const stocks = universeRef.current.length ? universeRef.current : await fetchUniverse();
      for (let i = 0; i < STAGES; i++) {
        if (abortRef.current) break;
        setStatus(`${i + 1}/10단계 분석 중 · ${i * 50 + 1}~${Math.min((i + 1) * 50, stocks.length)}위`);
        await runStage(i, stocks);
      }
      setStatus(abortRef.current ? '분석을 중지했습니다.' : '분석 완료 · 실패 구간이 있으면 해당 구간만 다시 시도할 수 있습니다.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : '분석 중 오류가 발생했습니다.');
    } finally {
      setRunning(false);
    }
  }

  async function retryFailed() {
    if (running || !failedStages.length) return;
    setRunning(true);
    abortRef.current = false;
    try {
      const stocks = universeRef.current.length ? universeRef.current : await fetchUniverse();
      for (const n of failedStages) {
        setStatus(`미수집 ${n}단계 재분석 중…`);
        await runStage(n - 1, stocks);
      }
      setStatus('미수집 구간 재분석을 마쳤습니다.');
    } finally {
      setRunning(false);
    }
  }

  function stop() {
    abortRef.current = true;
    setStatus('현재 단계가 끝나면 분석을 중지합니다.');
  }

  async function exportExcel() {
    if (!rows.length) return;
    const XLSX = await import('xlsx');
    const flat = visibleRows.map((r) => ({
      순위: r.rank,
      종목명: r.name,
      종목코드: r.code,
      종가: r.close ?? '',
      당일등락률: r.latestChangePct ?? '',
      거래량배수20일: r.volumeRatio ?? '',
      3일모멘텀: r.momentum3Pct ?? '',
      5일모멘텀: r.momentum5Pct ?? '',
      MA5: r.ma5 ?? '',
      MA20: r.ma20 ?? '',
      [`${lookbackDays}일내_${spikePct}%이상_급등횟수`]: r.spikeCount,
      관찰점수: r.score,
      최근뉴스건수: r.recentNewsCount,
      급등전뉴스: r.spikes.map((s) => `${s.date} ${s.pct}%:${s.preNews}${s.leadDays == null ? '' : `(${s.leadDays}일전)`}`).join(' | '),
      판단근거: r.reasons.join(', '),
      최신뉴스: r.latestNews.map((n) => n.title).join(' | '),
      네이버증권: naverStock(r.code),
      네이버뉴스: naverNews(r.name),
      YahooFinance: yahoo(r.code),
      오류: r.error ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(flat);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'KOSPI500 Radar');
    XLSX.writeFile(wb, `KOSPI500_뉴스급등레이더_${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true });
  }

  return (
    <main className="appShell">
      <header className="topbar">
        <div className="brandMark">◉</div>
        <div className="brandCopy">
          <b>코스피 뉴스 급등 레이더 V2</b>
          <span>NEWS × PRICE × VOLUME</span>
        </div>
        <button className="ghostBtn" onClick={() => start(true)} disabled={running}>⌕ 지금 새로 분석</button>
      </header>

      <section className="hero">
        <div className="eyebrow">NEWS × PRICE × VOLUME</div>
        <h1>급등 전에 뉴스는<br className="mobileBreak"/> 먼저 움직였는가?</h1>
        <p>KOSPI 시가총액 상위 500종목을 50개씩 안정적으로 수집하고, Yahoo Finance 일봉과 네이버 뉴스를 교차검증합니다. 실패한 구간은 자동 재시도하며 임의 값은 만들지 않습니다.</p>
      </section>

      <section className="statGrid">
        <div className="statCard"><span>수집 완료</span><strong>{completed}<em>/ 500</em></strong><small>종목</small></div>
        <div className="statCard"><span>{spikePct}%↑ 급등주</span><strong>{surged}<em>종목</em></strong><small>최근 {lookbackDays}거래일</small></div>
        <div className="statCard"><span>다음 거래일 후보</span><strong>{candidates}<em>종목</em></strong><small>관찰점수 {candidateMin}+</small></div>
      </section>

      <section className="stagePanel">
        <div className="stageHead">
          <div><b>500종목 수집·분석 진행상황</b><span>{status}</span></div>
          {running ? <button className="warnBtn" onClick={stop}>중지</button> : <button className="miniBtn" onClick={() => start(false)}>이어 분석</button>}
        </div>
        <div className="stageGrid">
          {stages.map((s, i) => <div key={i} className={`stage ${s.state}`} title={s.message || ''}>
            <span>{i + 1}</span><b>{s.state === 'done' ? '완료' : s.state === 'running' ? '진행' : s.state === 'failed' ? '실패' : '대기'}</b><small>{s.count || ''}</small>
          </div>)}
        </div>
        {failedStages.length > 0 && <div className="retryBox">
          <div><b>미수집 구간 {failedStages.join(', ')}단계</b><span>다른 구간 결과는 유지한 채 실패 구간만 다시 수집합니다.</span></div>
          <button onClick={retryFailed} disabled={running}>미수집만 재시도</button>
        </div>}
      </section>

      <section className="controls">
        <div className="control"><label>검색 기간</label><div><input type="number" min={20} max={240} value={lookbackDays} onChange={(e) => setLookbackDays(Number(e.target.value) || 60)}/><span>거래일</span></div></div>
        <div className="control"><label>급등 기준</label><div><input type="number" min={2} max={20} step={0.5} value={spikePct} onChange={(e) => setSpikePct(Number(e.target.value) || 5)}/><span>% 이상</span></div></div>
        <div className="control"><label>선행 뉴스 구간</label><div><input type="number" min={1} max={10} value={newsLeadDays} onChange={(e) => setNewsLeadDays(Number(e.target.value) || 3)}/><span>일 전</span></div></div>
        <div className="control"><label>후보 최소점수</label><div><input type="number" min={30} max={90} value={candidateMin} onChange={(e) => setCandidateMin(Number(e.target.value) || 55)}/><span>점</span></div></div>
      </section>

      <section className="candidateSection">
        <div className="sectionTitle"><div><span>TOMORROW WATCH</span><h2>다음 거래일 주목 후보</h2><p>점수는 예측 확률이 아니라 가격·거래량·최근 뉴스 기반 관찰 우선순위입니다.</p></div><div className="scorePill">{candidateRows.length} 종목</div></div>
        {!candidateRows.length ? <div className="emptyState">분석을 시작하면 조건에 맞는 후보가 여기에 표시됩니다.</div> : <div className="candidateGrid">
          {candidateRows.slice(0, 20).map((r, idx) => <article className="candidateCard" key={r.code}>
            <div className="rankBadge">#{idx + 1}</div>
            <div className="candidateName"><div><h3>{r.name}</h3><span>{r.code} · 시총 {capLabel(r.marketCap)}</span></div><strong>{r.score}<small>점</small></strong></div>
            <div className="metricRow"><span>등락 <b className={(r.latestChangePct ?? 0) >= 0 ? 'up' : 'down'}>{pct(r.latestChangePct)}</b></span><span>거래량 <b>{r.volumeRatio?.toFixed(2) ?? '-'}배</b></span><span>최근뉴스 <b>{r.recentNewsCount}건</b></span></div>
            <div className="tags">{r.reasons.slice(0, 6).map((x) => <i key={x}>{x}</i>)}</div>
            <div className="linkRow"><a href={naverStock(r.code)} target="_blank" rel="noreferrer">네이버증권</a><a href={naverNews(r.name)} target="_blank" rel="noreferrer">네이버뉴스</a><a href={yahoo(r.code)} target="_blank" rel="noreferrer">Yahoo</a></div>
          </article>)}
        </div>}
      </section>

      <section className="resultsSection">
        <div className="sectionTitle compact"><div><span>SURGE HISTORY</span><h2>급등 전 뉴스 검증</h2></div></div>
        <div className="toolbar">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="종목명 또는 코드 검색"/>
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as typeof sortMode)}><option value="score">점수순</option><option value="spike">급등횟수순</option><option value="volume">거래량순</option></select>
          <button onClick={exportExcel} disabled={!rows.length}>엑셀 저장</button>
        </div>
        <div className="tableWrap">
          <table>
            <thead><tr><th>종목</th><th>현재 지표</th><th>급등 이력</th><th>급등 전 뉴스</th><th>점수/근거</th><th>링크</th></tr></thead>
            <tbody>
              {visibleRows.map((r) => <tr key={r.code} className={!r.ok ? 'errorRow' : ''}>
                <td><b>{r.name}</b><small>{r.code} · #{r.rank}</small></td>
                <td>{r.ok ? <><span className={(r.latestChangePct ?? 0) >= 0 ? 'up' : 'down'}>{pct(r.latestChangePct)}</span><small>거래량 {r.volumeRatio?.toFixed(2) ?? '-'}배 · 3일 {pct(r.momentum3Pct)}</small></> : <span className="errorText">{r.error || '수집 실패'}</span>}</td>
                <td><b>{r.spikeCount}회</b>{r.spikes.slice(0, 3).map((s) => <small key={s.date}>{s.date} · +{s.pct.toFixed(1)}%</small>)}</td>
                <td>{r.spikes.length ? r.spikes.slice(0, 3).map((s) => <small key={s.date} className={`newsFlag ${s.preNews.toLowerCase()}`}>{s.preNews === 'YES' ? `있음 · ${s.leadDays}일 전` : s.preNews === 'NO' ? '확인 안 됨' : '뉴스 미수집'}{s.headline ? ` · ${s.headline}` : ''}</small>) : <span className="muted">급등 이력 없음</span>}</td>
                <td><b>{r.score}점</b><small>{r.reasons.slice(0, 5).join(' · ') || '-'}</small></td>
                <td><a href={naverStock(r.code)} target="_blank" rel="noreferrer">증권</a><a href={naverNews(r.name)} target="_blank" rel="noreferrer">뉴스</a></td>
              </tr>)}
              {!visibleRows.length && <tr><td colSpan={6}><div className="emptyState small">아직 분석 결과가 없습니다.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="launchPanel">
        <div><span>FULL SCAN</span><h2>KOSPI 500 분석 시작</h2><p>네이버 금융 시가총액 순위와 Yahoo Finance 실제 일봉을 사용합니다. 수집 실패 종목은 임의 값으로 대체하지 않습니다.</p></div>
        <button className="primaryBtn" onClick={() => start(true)} disabled={running}>{running ? '분석 진행 중…' : 'KOSPI 500 분석 시작'}</button>
      </section>

      <footer>
        <p>개인용 데이터 분석 도구 · 투자 판단은 사용자의 책임입니다. 뉴스 선행 여부는 수집 가능한 기사 날짜를 기준으로 계산되며 뉴스 누락 가능성이 있습니다.</p>
        <form action="/api/auth/logout" method="post"><button>로그아웃</button></form>
      </footer>
    </main>
  );
}
