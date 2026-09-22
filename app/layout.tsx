import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'KRX 5일선 급등·조정·반등 레이더',description:'코스피·코스닥 전종목 급등·조정·반등 패턴 스크리너'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>}
