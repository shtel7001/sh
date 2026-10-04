import crypto from 'crypto';

export const sessionCookieName = 'ktrade_permanent_session';
export const sessionMaxAge = 60 * 60 * 24 * 3650;

function secret() {
  return process.env.SESSION_SECRET || '';
}

function sign(payload:string) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function createSessionToken() {
  const exp = Math.floor(Date.now()/1000) + sessionMaxAge;
  const nonce = crypto.randomBytes(12).toString('base64url');
  const payload = `${exp}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token?:string|null) {
  if (!token || !secret()) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expRaw, nonce, sig] = parts;
  if (!expRaw || !nonce || !sig) return false;
  const payload = `${expRaw}.${nonce}`;
  const expected = sign(payload);
  if (sig.length !== expected.length) return false;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  } catch {
    return false;
  }
  const exp = Number(expRaw);
  return Number.isFinite(exp) && exp > Date.now()/1000;
}
