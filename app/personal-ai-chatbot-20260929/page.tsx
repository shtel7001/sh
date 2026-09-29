'use client';

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import styles from './page.module.css';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

const STORAGE_KEY = 'personal-ai-chatbot-20260929-history-v1';
const starterMessages: Message[] = [
  {
    role: 'assistant',
    content: '안녕하세요. 개인 전용 AI 비서입니다. 궁금한 것, 분석할 내용, 아이디어 정리 등을 편하게 말씀해 주세요.',
  },
];

export default function PersonalAiChatbotPage() {
  const [sessionChecked, setSessionChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [code, setCode] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [messages, setMessages] = useState<Message[]>(starterMessages);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Message[];
        if (Array.isArray(parsed) && parsed.length) setMessages(parsed);
      }
    } catch {}

    fetch('/api/personal-ai/session', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => setAuthenticated(Boolean(data?.authenticated)))
      .catch(() => setAuthenticated(false))
      .finally(() => setSessionChecked(true));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {}
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const canSend = useMemo(
    () => authenticated && input.trim().length > 0 && !busy,
    [authenticated, input, busy],
  );

  async function login(event: FormEvent) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError('');
    try {
      const response = await fetch('/api/personal-ai/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || '인증에 실패했습니다.');
      setAuthenticated(true);
      setCode('');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : '인증에 실패했습니다.');
    } finally {
      setLoginBusy(false);
    }
  }

  async function logout() {
    await fetch('/api/personal-ai/logout', { method: 'POST' }).catch(() => undefined);
    setAuthenticated(false);
  }

  function newChat() {
    setMessages(starterMessages);
    setInput('');
    setError('');
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  async function submit() {
    const content = input.trim();
    if (!content || busy) return;

    const nextMessages: Message[] = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setInput('');
    setError('');
    setBusy(true);

    try {
      const response = await fetch('/api/personal-ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const data = await response.json();
      if (response.status === 401) {
        setAuthenticated(false);
        throw new Error('로그인이 만료되었습니다. 다시 인증해 주세요.');
      }
      if (!response.ok) throw new Error(data?.error || '답변 생성에 실패했습니다.');
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: String(data?.text || '답변을 생성하지 못했습니다.') },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function onComposerSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSend) void submit();
    }
  }

  if (!sessionChecked) {
    return (
      <main className={styles.centerScreen}>
        <div className={styles.loader} />
        <p>보안 세션 확인 중…</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className={styles.loginPage}>
        <section className={styles.loginCard}>
          <div className={styles.brandMark}>AI</div>
          <p className={styles.eyebrow}>PRIVATE · PERSONAL</p>
          <h1>나의 AI 비서</h1>
          <p className={styles.loginCopy}>
            개인 인증번호가 있어야 사용할 수 있습니다. 인증한 기기는 1년 동안 로그인 상태가 유지됩니다.
          </p>
          <form onSubmit={login} className={styles.loginForm}>
            <label htmlFor="personal-ai-code">개인 인증번호</label>
            <input
              id="personal-ai-code"
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={12}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 12))}
              placeholder="12자리 숫자"
              autoFocus
            />
            {loginError ? <p className={styles.formError}>{loginError}</p> : null}
            <button disabled={loginBusy || code.length !== 12}>
              {loginBusy ? '인증 중…' : '내 AI 열기'}
            </button>
          </form>
          <p className={styles.securityNote}>🔒 인증 쿠키는 HttpOnly · Secure · SameSite=Strict로 보호됩니다.</p>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brandRow}>
          <div className={`${styles.brandMark} ${styles.small}`}>AI</div>
          <div>
            <strong>나의 AI 비서</strong>
            <span className={styles.online}><i /> GPT-5.6 Sol</span>
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={newChat}>새 대화</button>
          <button type="button" onClick={logout}>로그아웃</button>
        </div>
      </header>

      <section className={styles.chatWrap}>
        <div className={styles.quickRow}>
          <button type="button" onClick={() => setInput('오늘 해야 할 일을 우선순위로 정리해줘.')}>할 일 정리</button>
          <button type="button" onClick={() => setInput('이 아이디어의 장단점과 개선점을 분석해줘.')}>아이디어 분석</button>
          <button type="button" onClick={() => setInput('주식 종목을 분석할 때 확인해야 할 핵심 항목을 정리해줘.')}>주식 분석</button>
        </div>

        <div className={styles.messages} aria-live="polite">
          {messages.map((message, index) => (
            <article key={`${message.role}-${index}`} className={`${styles.message} ${message.role === 'user' ? styles.user : ''}`}>
              <div className={styles.avatar}>{message.role === 'assistant' ? 'AI' : '나'}</div>
              <div className={styles.bubble}>
                <div className={styles.messageLabel}>{message.role === 'assistant' ? 'AI 비서' : '나'}</div>
                <div className={styles.messageText}>{message.content}</div>
              </div>
            </article>
          ))}

          {busy ? (
            <article className={styles.message}>
              <div className={styles.avatar}>AI</div>
              <div className={`${styles.bubble} ${styles.typing}`}><span /><span /><span /></div>
            </article>
          ) : null}

          {error ? <div className={styles.chatError}>{error}</div> : null}
          <div ref={bottomRef} />
        </div>
      </section>

      <form className={styles.composer} onSubmit={onComposerSubmit}>
        <div className={styles.composerInner}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="무엇이든 물어보세요…"
            rows={1}
            maxLength={12000}
          />
          <button type="submit" disabled={!canSend} aria-label="전송">↑</button>
        </div>
        <p>대화 기록은 이 기기의 브라우저에 저장됩니다. 질문 내용은 답변 생성을 위해 AI 제공자에게 전송됩니다.</p>
      </form>
    </main>
  );
}
