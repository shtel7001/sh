const SOURCE = 'https://raw.githubusercontent.com/shtel7001/sh/main/designs/threads-commerce-radar-1000-compact-20260923.html';

export const dynamic = 'force-dynamic';

export async function GET() {
  const response = await fetch(SOURCE, { cache: 'no-store' });
  if (!response.ok) {
    return new Response('Threads Commerce Radar source unavailable', { status: 502 });
  }
  const html = await response.text();
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}
