import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/guard';
import LoginForm from '@/components/LoginForm';
export default async function Login(){if(await isAuthed())redirect('/');return <main className="loginWrap"><section className="loginCard"><div className="eyebrow">PRIVATE · ONE-TIME LOGIN</div><h1>KOSPI 500 뉴스 급등 레이더 V2</h1><p>한 번 인증하면 이 브라우저에서는 세션 쿠키로 계속 사용할 수 있습니다. 가격·거래량·뉴스를 실제 수집값으로 교차분석합니다.</p><LoginForm/><small>비밀번호는 브라우저 localStorage에 저장하지 않습니다.</small></section></main>}
