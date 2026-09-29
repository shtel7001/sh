import crypto from 'crypto';

const ACCESS_CODE_SHA256 = '0c725fd4fccd0387cc854a68aadbd47b8e412ffcc8afa978bba80952d1e8efba';
const COOKIE_NAME = 'personal_ai_session';
const MAX_AGE = 60 * 60 * 24 * 365;

function sessionSecret() {
  return process.env.SESSION_SECRET || '';
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sign(payload: string) {
  return crypto
    .createHmac('sha256', `${sessionSecret()}:personal-ai-v1`)
    .update(payload)
    .digest('base64url');
}

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

export function verifyPersonalAiAccessCode(value: unknown) {
  const code = String(value ?? '').trim();
  if (!/^\d{12}$/.test(code)) return false;
  return safeEqual(sha256(code), ACCESS_CODE_SHA256);
}

export function createPersonalAiSession() {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = String(exp);
  return `${payload}.${sign(payload)}`;
}

export function verifyPersonalAiSession(token?: string | null) {
  if (!token || !sessionSecret()) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = sign(payload);
  if (!safeEqual(signature, expected)) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && exp > Date.now() / 1000;
}

export const personalAiCookieName = COOKIE_NAME;
export const personalAiSessionMaxAge = MAX_AGE;
