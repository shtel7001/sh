import { GET as runRadar } from '../kr-fixed-date-event-radar-20260928/route';
export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
export async function GET(){
  const req=new Request('https://selftest.local/api/kr-fixed-date-event-radar-20260928?market=ALL&lookback=120&horizon=120',{headers:{'x-access-code':'17382171'}});
  return runRadar(req);
}
