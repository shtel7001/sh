import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/guard';
import LoginForm from '@/components/LoginForm';
export default async function Login(){if(await isAuthed())redirect('/');return <main className="loginWrap"><section className="loginCard"><div className="eyebrow">PRIVATE RADAR V4</div><h1>과거 급등 전조 레이더 V4</h1><p>V2 방식으로 검색 종목을 선택하고, 과거 급등 전조와 현재 신호를 비교합니다.</p><LoginForm/><small>비밀번호는 브라우저 localStorage에 저장하지 않습니다.</small></section></main>}
