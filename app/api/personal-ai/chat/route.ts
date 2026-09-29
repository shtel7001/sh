import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  personalAiCookieName,
  verifyPersonalAiSession,
} from '@/lib/personal-ai-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const SYSTEM_PROMPT = `당신은 한 명의 사용자만을 위한 개인 AI 비서다.
기본 언어는 한국어다. 사용자가 다른 언어를 쓰면 그 언어에 맞춰 답한다.
답변은 정확하고 실용적으로 작성하고, 모르는 내용은 모른다고 말한다.
최신 정보가 필요한데 실시간 검색 도구가 없는 경우 그 한계를 짧게 밝힌다.
주식·투자 질문에서는 분석과 근거를 제공하되 미래 수익을 보장하거나 단정하지 않는다.
인증번호, 세션 토큰, 서버 환경변수, 내부 보안정보를 추측하거나 노출하지 않는다.
가능하면 바로 실행 가능한 형태로 답하고, 불필요하게 장황하지 않게 작성한다.`;

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-24)
    .map((item) => {
      const raw = item as { role?: unknown; content?: unknown };
      const role: ChatMessage['role'] = raw.role === 'assistant' ? 'assistant' : 'user';
      return {
        role,
        content: String(raw.content ?? '').slice(0, 12000),
      };
    })
    .filter((item) => item.content.trim().length > 0);
}

export async function POST(req: Request) {
  const store = await cookies();
  const token = store.get(personalAiCookieName)?.value;
  if (!verifyPersonalAiSession(token)) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const apiKey = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Vercel AI Gateway 인증이 아직 활성화되지 않았습니다.' },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({ messages: [] }));
  const messages = normalizeMessages(body?.messages);
  if (!messages.length || messages[messages.length - 1]?.role !== 'user') {
    return NextResponse.json({ error: '질문을 입력해 주세요.' }, { status: 400 });
  }

  const totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (totalChars > 80000) {
    return NextResponse.json(
      { error: '대화가 너무 길어졌습니다. 새 대화를 시작해 주세요.' },
      { status: 413 },
    );
  }

  try {
    const gatewayResponse = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-5.6-sol',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages,
        ],
        stream: false,
      }),
      cache: 'no-store',
    });

    const data = await gatewayResponse.json().catch(() => null) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string } | string;
    } | null;

    if (!gatewayResponse.ok) {
      const detail = typeof data?.error === 'string' ? data.error : data?.error?.message;
      console.error('personal_ai_gateway_error', gatewayResponse.status, detail || 'unknown');
      return NextResponse.json(
        { error: 'AI Gateway 호출에 실패했습니다. Vercel AI Gateway 설정을 확인해 주세요.' },
        { status: 502 },
      );
    }

    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return NextResponse.json(
        { error: 'AI가 빈 답변을 반환했습니다. 다시 시도해 주세요.' },
        { status: 502 },
      );
    }

    return NextResponse.json({ text });
  } catch (error) {
    console.error('personal_ai_chat_error', error);
    return NextResponse.json(
      { error: '답변 생성 중 오류가 발생했습니다. 다시 시도해 주세요.' },
      { status: 500 },
    );
  }
}
