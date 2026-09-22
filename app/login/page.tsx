import {redirect} from 'next/navigation';
import {isAuthed} from '@/lib/guard';
import LoginForm from '@/components/LoginForm';
export default async function Login(){if(await isAuthed())redirect('/');return <main className="loginWrap"><section className="loginCard"><div className="eyebrow">PRIVATE · LATE RUNNER STREAM</div><h1>유행 테마 후발주 스트리밍 레이더</h1><p>KOSPI·KOSDAQ에서 강한 테마를 먼저 잡고, 아직 덜 오른 과거 급등형 후발주를 자동으로 압축합니다.</p><LoginForm/><small>비밀번호는 브라우저 저장소에 저장하지 않고 인증 쿠키만 사용합니다.</small></section></main>}
