import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/guard';
import LoginForm from '@/components/LoginForm';
export default async function Login(){if(await isAuthed())redirect('/');return <main className="loginWrap"><section className="loginCard"><div className="eyebrow">PRIVATE RADAR</div><h1>급등 전조 학습 레이더 V3</h1><p>급등 후 뉴스가 아니라, 급등 전 이상징후를 찾습니다.</p><LoginForm/><small>비밀번호는 브라우저 localStorage에 저장하지 않습니다.</small></section></main>}
