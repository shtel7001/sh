import './globals.css';

export const metadata = {
  title: 'K-Trade Flow | 수출입 흐름 대시보드',
  description: '관세청·산업통상부 무역통계를 한 화면에서 보는 개인용 수출입 대시보드',
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="ko"><body>{children}</body></html>;
}
