import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const token = () => randomBytes(32).toString('base64url');

export function hashSecret(value: string, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`;
}

export function verifySecret(value: string, stored: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(value, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

export function text(input: unknown, min = 1, max = 200): string {
  if (typeof input !== 'string') throw Object.assign(new Error('请输入有效的文本'), { statusCode: 400 });
  const result = input.trim();
  if (result.length < min || result.length > max) {
    throw Object.assign(new Error(`文本长度应为 ${min}–${max} 个字符`), { statusCode: 400 });
  }
  return result;
}
