import {redirect} from 'next/navigation';
import {isAuthed} from '@/lib/guard';
import LoginForm from '@/components/LoginForm';
export default async function Login(){if(await isAuthed())redirect('/');return <main className="loginWrap"><section className="loginCard"><div className="eyebrow">PRIVATE · ONE-TIME AUTH</div><h1>KRX 장기 우하향 · 5/20 골든크로스 · 20일선 재접근 레이더</h1><p>코스피·코스닥 전종목에서 장기 하락 후 추세전환 초기에 20일선 근처로 되돌아온 후보를 찾는 개인용 레이더입니다.</p><LoginForm/><small>최초 인증 후 보안 세션 쿠키로 접속을 유지합니다. 비밀번호는 브라우저 저장소에 저장하지 않습니다.</small></section></main>}
