import { NextRequest } from 'next/server';
import { GET as legacyGET, POST as legacyPOST } from '../kr-news-surge-radar-20261001-legacy/route';
import { POST as scanPOST } from '../kr-news-surge-radar-20261001-scan-v2/route';

export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';

export async function GET(req:NextRequest){
  return legacyGET(req);
}

export async function POST(req:NextRequest){
  if((req.nextUrl.searchParams.get('op')||'')==='scan') return scanPOST(req);
  return legacyPOST(req);
}
