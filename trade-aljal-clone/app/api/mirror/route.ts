import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { load } from 'cheerio';
import { sessionCookieName, verifySession } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ORIGIN = 'https://trade.aljal.kr';

function normalizePath(raw:string|null) {
  const value = (raw || '/').trim();
  if (!value.startsWith('/')) return null;
  if (value.includes('..') || value.includes('\\')) return null;
  try {
    const url = new URL(value, ORIGIN);
    if (url.origin !== ORIGIN) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

function absolutize(value:string|undefined) {
  if (!value) return value;
  try { return new URL(value, ORIGIN).toString(); }
  catch { return value; }
}

export async function GET(req:Request) {
  const jar = await cookies();
  if (!verifySession(jar.get(sessionCookieName)?.value)) {
    return NextResponse.json({error:'인증이 필요합니다.'},{status:401});
  }

  const { searchParams } = new URL(req.url);
  const path = normalizePath(searchParams.get('path'));
  if (!path) return NextResponse.json({error:'잘못된 경로입니다.'},{status:400});

  const sourceUrl = ORIGIN + path;
  let response:Response;
  try {
    response = await fetch(sourceUrl, {
      cache:'no-store',
      headers:{
        'user-agent':'Mozilla/5.0 (compatible; KTradeFlow/1.0; +https://vercel.com)',
        'accept':'text/html,application/xhtml+xml'
      },
      signal:AbortSignal.timeout(15000)
    });
  } catch {
    return NextResponse.json({error:'원본 수출입 페이지에 연결하지 못했습니다.'},{status:502});
  }

  if (!response.ok) {
    return NextResponse.json({error:`원본 페이지 응답 오류 (${response.status})`},{status:502});
  }

  const raw = await response.text();
  const $ = load(raw);
  const title = $('title').first().text().trim() || '수출입 통계';
  const main = $('main').first().length ? $('main').first() : $('body').first();

  main.find('script,style,noscript,iframe,form,meta,link').remove();
  main.find('header,footer').remove();

  main.find('*').each((_i, el) => {
    const attrs = (el as any).attribs || {};
    for (const key of Object.keys(attrs)) {
      if (/^on/i.test(key)) $(el).removeAttr(key);
      if (key === 'style') $(el).removeAttr(key);
    }
  });

  main.find('a').each((_i, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    if (href.startsWith('#')) return;
    try {
      const url = new URL(href, ORIGIN);
      if (url.origin === ORIGIN) {
        $(el).attr('href','#');
        $(el).attr('data-trade-path', url.pathname + url.search);
      } else {
        $(el).attr('href',url.toString());
        $(el).attr('target','_blank');
        $(el).attr('rel','noopener noreferrer');
      }
    } catch {}
  });

  main.find('img').each((_i,el)=>{
    const src = $(el).attr('src');
    if (src) $(el).attr('src',absolutize(src) || src);
    const srcset = $(el).attr('srcset');
    if (srcset) {
      const fixed = srcset.split(',').map(part=>{
        const bits = part.trim().split(/\s+/);
        bits[0] = absolutize(bits[0]) || bits[0];
        return bits.join(' ');
      }).join(', ');
      $(el).attr('srcset',fixed);
    }
    $(el).attr('loading','lazy');
  });

  main.find('svg').attr('aria-hidden','true');

  return NextResponse.json({
    ok:true,
    path,
    sourceUrl,
    title,
    html:main.html() || '',
    fetchedAt:new Date().toISOString(),
    dataSources:[
      '관세청 수출입무역통계 / 공공데이터포털',
      '산업통상부 월간 수출입 동향',
      '대한민국 정책브리핑 원문'
    ]
  },{
    headers:{'cache-control':'no-store, max-age=0'}
  });
}
