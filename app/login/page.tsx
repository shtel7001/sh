import {redirect} from 'next/navigation';
import {isAuthed} from '@/lib/guard';
import LoginForm from '@/components/LoginForm';
export default async function Login(){if(await isAuthed())redirect('/');return <main className="loginWrap"><section className="loginCard"><div className="eyebrow">PRIVATE · ONE-TIME AUTH</div><h1>KRX 5일선 저점매수 · 우상향 스윙 레이더</h1><p>코스피·코스닥 전종목에서 우상향 추세의 5일선 눌림·저점권 후보를 찾는 개인용 레이더입니다.</p><LoginForm/><small>인증번호는 브라우저 저장소에 저장하지 않고 서버에서만 확인합니다.</small></section></main>}
