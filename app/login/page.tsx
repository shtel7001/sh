import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/guard';
import LoginForm from '@/components/LoginForm';
export default async function Login(){if(await isAuthed())redirect('/');return <main className="loginWrap"><section className="loginCard"><div className="eyebrow">PRIVATE KOSPI SCANNER</div><h1>KOSPI 전종목 240일 급등 스캐너</h1><p>처음 한 번 개인 비밀번호로 인증하면 이 브라우저에서 계속 사용할 수 있습니다.</p><LoginForm/><small>비밀번호는 브라우저 localStorage에 저장하지 않고 보안 세션 쿠키로 유지합니다.</small></section></main>}
