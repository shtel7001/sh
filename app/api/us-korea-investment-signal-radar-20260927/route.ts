import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ACCESS_HASH = 'f70016241761c5887d6dfd3508020634edd33a93e910e2f99273f57592a1617e';

type Signal = {
  id: string;
  date: string;
  source: string;
  sourceType: string;
  sourceHome: string;
  title: string;
  url: string;
  company: string[];
  sectors: string[];
  stocks: string[];
  triggers: string[];
  score: number;
  reason: string;
};

const companyMap: Record<string, { aliases: string[]; stocks: string[]; sectors: string[] }> = {
  Hanwha: { aliases: ['hanwha', 'philly shipyard'], stocks: ['한화오션(042660)', '한화시스템(272210)', '한화엔진(082740)'], sectors: ['조선·MRO', '방산전자', '조선기자재'] },
  Hyundai: { aliases: ['hd hyundai', 'hyundai heavy', 'hd korea shipbuilding', 'hyundai electric'], stocks: ['HD한국조선해양(009540)', 'HD현대중공업(329180)', 'HD현대일렉트릭(267260)'], sectors: ['조선·MRO', '전력기기'] },
  Samsung: { aliases: ['samsung'], stocks: ['삼성전자(005930)', '삼성중공업(010140)', '삼성바이오로직스(207940)'], sectors: ['반도체', '조선', '바이오·의약품'] },
  SK: { aliases: ['sk hynix', 'sk innovation', 'sk on', 'sk group'], stocks: ['SK하이닉스(000660)', 'SK이노베이션(096770)'], sectors: ['HBM·반도체', '배터리·에너지'] },
  LS: { aliases: ['ls electric', 'ls cable', 'gaon cable', 'ls group'], stocks: ['LS ELECTRIC(010120)', 'LS(006260)', '가온전선(000500)'], sectors: ['전력기기', '송배전망·전선'] },
  POSCO: { aliases: ['posco', 'posco future m'], stocks: ['POSCO홀딩스(005490)', '포스코퓨처엠(003670)'], sectors: ['핵심광물', '배터리소재', '철강'] },
  Doosan: { aliases: ['doosan'], stocks: ['두산에너빌리티(034020)'], sectors: ['원전·SMR', '가스터빈·발전'] },
};

const triggerMap: Record<string, string[]> = {
  '인허가': ['permit', 'approval', 'authorization', 'environmental review'],
  '전력망연계': ['interconnection', 'substation', 'transmission', 'power grid', 'transformer', 'megawatt'],
  '토지·건설': ['land acquisition', 'site selection', 'construction', 'groundbreaking', 'facility', 'plant'],
  '인센티브·보조금': ['incentive', 'tax credit', 'grant', 'subsidy', 'funding'],
  '조달·계약': ['procurement', 'contract', 'award', 'subcontract', 'rfp', 'solicitation'],
  'MOU·파트너십': ['memorandum', 'partnership', 'joint venture', 'agreement', 'mou'],
  '조선·함정': ['shipyard', 'shipbuilding', 'navy', 'vessel', 'submarine', 'maritime', ' mro '],
  '반도체·HBM': ['semiconductor', 'advanced packaging', ' hbm ', 'chip fab', 'wafer'],
  'AI·데이터센터': ['data center', 'datacenter', 'artificial intelligence', ' ai '],
  '에너지·LNG': [' lng ', 'natural gas', 'power plant', 'energy infrastructure'],
  '원전·SMR': ['nuclear', 'small modular reactor', ' smr '],
  '핵심광물': ['critical mineral', 'rare earth', 'lithium', 'nickel', 'graphite'],
};

const sources = [
  { name: 'White House', type: '연방정부', domain: 'whitehouse.gov', home: 'https://www.whitehouse.gov/' },
  { name: 'U.S. Commerce', type: '연방정부', domain: 'commerce.gov', home: 'https://www.commerce.gov/' },
  { name: 'USTR', type: '연방정부', domain: 'ustr.gov', home: 'https://ustr.gov/' },
  { name: 'DOE', type: '연방정부', domain: 'energy.gov', home: 'https://www.energy.gov/' },
  { name: 'FERC', type: '연방정부', domain: 'ferc.gov', home: 'https://www.ferc.gov/' },
  { name: 'MARAD', type: '연방정부', domain: 'maritime.dot.gov', home: 'https://www.maritime.dot.gov/' },
  { name: 'U.S. Navy', type: '연방정부', domain: 'navy.mil', home: 'https://www.navy.mil/' },
  { name: 'DoD', type: '연방정부', domain: 'defense.gov', home: 'https://www.defense.gov/' },
  { name: 'Texas', type: '주정부', domain: 'texas.gov', home: 'https://www.texas.gov/' },
  { name: 'Pennsylvania', type: '주정부', domain: 'pa.gov', home: 'https://www.pa.gov/' },
  { name: 'Virginia', type: '주정부', domain: 'virginia.gov', home: 'https://www.virginia.gov/' },
  { name: 'Indiana', type: '주정부', domain: 'in.gov', home: 'https://www.in.gov/' },
];

function isAuthorized(req: NextRequest) {
  const code = req.headers.get('x-access-code') || '';
  const got = crypto.createHash('sha256').update(code).digest('hex');
  const a = Buffer.from(got);
  const b = Buffer.from(ACCESS_HASH);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function clean(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, name: string) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? clean(m[1]) : '';
}

function analyze(text: string) {
  const lower = ` ${text.toLowerCase()} `;
  const company: string[] = [];
  const stocks = new Set<string>();
  const sectors = new Set<string>();
  for (const [name, cfg] of Object.entries(companyMap)) {
    if (cfg.aliases.some(a => lower.includes(a))) {
      company.push(name);
      cfg.stocks.forEach(x => stocks.add(x));
      cfg.sectors.forEach(x => sectors.add(x));
    }
  }
  const triggers: string[] = [];
  for (const [label, words] of Object.entries(triggerMap)) {
    if (words.some(w => lower.includes(w))) {
      triggers.push(label);
      if (label === '전력망연계') sectors.add('전력기기·전력망');
      if (label === 'AI·데이터센터') sectors.add('AI 데이터센터 인프라');
      if (label === '에너지·LNG') sectors.add('LNG·가스발전');
      if (label === '원전·SMR') sectors.add('원전·SMR');
      if (label === '핵심광물') sectors.add('핵심광물·배터리소재');
    }
  }
  return { company, stocks: [...stocks], sectors: [...sectors], triggers };
}

function signalScore(company: string[], triggers: string[], date: string, type: string) {
  let score = type === '연방정부' || type === '주정부' ? 20 : 10;
  score += Math.min(30, company.length * 20);
  score += Math.min(40, triggers.length * 8);
  const age = Math.max(0, (Date.now() - new Date(date).getTime()) / 86400000);
  if (age <= 2) score += 10;
  else if (age <= 7) score += 6;
  return Math.min(100, score);
}

async function federalRegister(days: number): Promise<Signal[]> {
  const out: Signal[] = [];
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const terms = ['Korea investment', 'Hanwha', 'Hyundai', 'Samsung', 'SK hynix', 'LS Electric', 'POSCO', 'Doosan'];
  await Promise.all(terms.map(async term => {
    const u = new URL('https://www.federalregister.gov/api/v1/documents.json');
    u.searchParams.set('per_page', '50');
    u.searchParams.set('order', 'newest');
    u.searchParams.set('conditions[term]', term);
    u.searchParams.set('conditions[publication_date][gte]', from);
    try {
      const r = await fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
      if (!r.ok) return;
      const j: any = await r.json();
      for (const d of j.results || []) {
        const m = analyze(`${d.title || ''} ${d.abstract || ''}`);
        if (!m.company.length || !m.triggers.length) continue;
        const date = d.publication_date || new Date().toISOString();
        out.push({ id: `fr-${d.document_number || crypto.randomUUID()}`, date, source: 'Federal Register', sourceType: '연방정부', sourceHome: 'https://www.federalregister.gov/', title: d.title || 'Federal Register document', url: d.html_url || d.pdf_url || 'https://www.federalregister.gov/', company: m.company, sectors: m.sectors, stocks: m.stocks, triggers: m.triggers, score: signalScore(m.company, m.triggers, date, '연방정부'), reason: `${m.company.join('·')} + ${m.triggers.slice(0, 4).join('·')} 공식문서 신호` });
      }
    } catch {}
  }));
  return out;
}

async function officialDomainIndex(days: number): Promise<Signal[]> {
  const out: Signal[] = [];
  const companies = '(Hanwha OR Hyundai OR Samsung OR "SK Hynix" OR "LS Electric" OR POSCO OR Doosan)';
  const events = '(investment OR permit OR interconnection OR incentive OR grant OR contract OR procurement OR shipyard OR semiconductor OR "data center" OR substation OR nuclear OR LNG OR "critical minerals")';
  await Promise.all(sources.map(async src => {
    const q = `${companies} ${events} site:${src.domain} when:${days}d`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    try {
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
      if (!r.ok) return;
      const xml = await r.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const item of items.slice(0, 30)) {
        const title = tag(item, 'title');
        const description = tag(item, 'description');
        const link = tag(item, 'link');
        const pub = tag(item, 'pubDate');
        const m = analyze(`${title} ${description}`);
        if (!m.company.length || !m.triggers.length) continue;
        let date = new Date().toISOString();
        try { if (pub) date = new Date(pub).toISOString(); } catch {}
        const displayTitle = title.replace(/\s+-\s+[^-]+$/, '').trim() || title;
        out.push({ id: `${src.domain}-${crypto.createHash('sha1').update(title).digest('hex').slice(0,16)}`, date, source: src.name, sourceType: src.type, sourceHome: src.home, title: displayTitle, url: link || src.home, company: m.company, sectors: m.sectors, stocks: m.stocks, triggers: m.triggers, score: signalScore(m.company, m.triggers, date, src.type), reason: `${src.name} 공식 도메인에서 ${m.company.join('·')} 관련 ${m.triggers.slice(0, 4).join('·')} 포착` });
      }
    } catch {}
  }));
  return out;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const action = req.nextUrl.searchParams.get('action') || 'scan';
  if (action === 'auth') return NextResponse.json({ ok: true });
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get('days') || 30)));
  const [a, b] = await Promise.all([federalRegister(days), officialDomainIndex(days)]);
  const dedup = new Map<string, Signal>();
  for (const s of [...a, ...b]) {
    const key = s.title.toLowerCase().replace(/\W+/g, ' ').slice(0, 130);
    const old = dedup.get(key);
    if (!old || s.score > old.score) dedup.set(key, s);
  }
  const signals = [...dedup.values()].sort((x, y) => y.score - x.score || +new Date(y.date) - +new Date(x.date)).slice(0, 200);
  return NextResponse.json({ generatedAt: new Date().toISOString(), days, count: signals.length, signals, sources });
}
