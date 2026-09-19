import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/guard';
import LoginForm from '@/components/LoginForm';
export default async function Login(){if(await isAuthed())redirect('/');return <main className="loginWrap"><section className="loginCard"><div className="eyebrow">PRIVATE AUTO-LEARNING RADAR · NEON DB</div><h1>급등 전조 자동학습 레이더 V5</h1><p>TOP80 탐지와 Neon 서버 DB 누적 학습을 사용합니다.</p><LoginForm/><small>비밀번호는 브라우저 localStorage에 저장하지 않습니다.</small></section></main>}
