import {redirect} from 'next/navigation';
import {isAuthed} from '@/lib/guard';
import LoginForm from '@/components/LoginForm';
export default async function Login(){if(await isAuthed())redirect('/');return <main className="loginWrap"><section className="loginCard"><div className="eyebrow">PRIVATE · ONE-TIME AUTH</div><h1>KOSPI 5일선 재돌파 레이더</h1><p>이 브라우저에서 한 번 인증하면 보안 쿠키로 최대 1년 유지됩니다.</p><LoginForm/><small>인증번호는 브라우저 저장소에 저장하지 않고 서버에서만 확인합니다.</small></section></main>}
