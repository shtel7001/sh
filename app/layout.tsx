import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'KRX 5일선 저점매수 · 우상향 스윙 레이더',description:'코스피·코스닥 전종목 우상향 5일선 눌림 저점 스크리너'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>}
