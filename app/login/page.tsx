import {redirect} from 'next/navigation';
import {isAuthed} from '@/lib/guard';
import LoginForm from '@/components/LoginForm';
export default async function Login(){if(await isAuthed())redirect('/');return <main className="loginWrap"><section className="loginCard"><div className="eyebrow">PRIVATE · KOSDAQ NEXT-DAY RADAR</div><h1>KOSDAQ 다음날 급등 전조 레이더</h1><p>14:00부터 전종목을 분석해 장 마감 전에 다음 거래일 전조 후보를 추립니다.</p><LoginForm/><small>비밀번호는 브라우저 저장소에 저장하지 않고, 인증 쿠키만 사용합니다.</small></section></main>}
