import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/guard';
import LoginForm from '@/components/LoginForm';
export default async function Login(){if(await isAuthed())redirect('/');return <main className="loginWrap"><section className="loginCard"><div className="eyebrow">PRIVATE AUTO-LEARNING RADAR</div><h1>급등 전조 자동학습 레이더 V4</h1><p>과거 백테스트와 실제 탐지 성과를 반영해 신호 가중치를 자동 조정합니다.</p><LoginForm/><small>비밀번호는 브라우저 localStorage에 저장하지 않습니다.</small></section></main>}
