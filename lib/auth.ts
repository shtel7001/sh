import crypto from 'crypto';

const COOKIE = 'psr_v3_session';
const MAX_AGE = 60 * 60 * 24 * 180;

function secret() { return process.env.SESSION_SECRET || ''; }
function sign(payload: string) { return crypto.createHmac('sha256', secret()).update(payload).digest('base64url'); }

export function createSessionToken() {
  const exp = Math.floor(Date.now()/1000) + MAX_AGE;
  const payload = String(exp);
  return `${payload}.${sign(payload)}`;
}
export function verifySession(token?: string | null) {
  if (!token || !secret()) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
  if (sig.length !== expected.length) return false;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  } catch { return false; }
  const exp = Number(payload);
  return Number.isFinite(exp) && exp > Date.now()/1000;
}
export const sessionCookieName = COOKIE;
export const sessionMaxAge = MAX_AGE;
