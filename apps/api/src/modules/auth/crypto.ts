import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { jwtVerify, SignJWT } from 'jose';
import { COMMON_PASSWORDS } from './common-passwords';

// docs/09 §3: Argon2id m=19456 KiB, t=2, p=1 (mức tối thiểu OWASP)
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
// Hash giả để so khi email không tồn tại: thời gian phản hồi như nhau
const DUMMY_HASH = hash('dummy-password-for-timing', ARGON);

export const hashPassword = (pw: string) => hash(pw, ARGON);

export async function verifyPassword(hashed: string | null, pw: string): Promise<boolean> {
  if (!hashed) {
    await verify(await DUMMY_HASH, pw).catch(() => false);
    return false;
  }
  return verify(hashed, pw).catch(() => false);
}

export function isCommonPassword(pw: string): boolean {
  return COMMON_PASSWORDS.has(pw.toLowerCase());
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Mật khẩu tạm cho thành viên mới / reset bằng CLI */
export const temporaryPassword = () => randomToken(12);

// ---- JWT (docs/09 §3): HS256, 15 phút, claim sub + sid, hỗ trợ nhiều khóa theo kid ----
export const ACCESS_TOKEN_TTL_S = 15 * 60;

export class JwtKeys {
  private readonly keys: Array<{ kid: string; key: Uint8Array }>;

  constructor(config: string) {
    this.keys = config.includes(':')
      ? config.split(',').map((pair) => {
          const i = pair.indexOf(':');
          return { kid: pair.slice(0, i).trim(), key: Buffer.from(pair.slice(i + 1).trim()) };
        })
      : [{ kid: 'k1', key: Buffer.from(config) }];
  }

  sign(sub: string, sid: string): Promise<string> {
    const { kid, key } = this.keys[0]!;
    return new SignJWT({ sid })
      .setProtectedHeader({ alg: 'HS256', kid })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_S}s`)
      .sign(key);
  }

  async verify(token: string): Promise<{ sub: string; sid: string }> {
    const { payload } = await jwtVerify(
      token,
      (header) => {
        const k = this.keys.find((x) => x.kid === header.kid);
        if (!k) throw new Error('kid không hợp lệ');
        return k.key;
      },
      { algorithms: ['HS256'] },
    );
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      throw new Error('Thiếu claim');
    }
    return { sub: payload.sub, sid: payload.sid };
  }
}

// ---- Token service account: qah_<prefix8>_<secret> (docs/05 §2) ----
const SA_TOKEN = /^qah_([A-Za-z0-9]{8})_([A-Za-z0-9_-]{20,})$/;

export function newServiceAccountToken(): { token: string; prefix: string; hash: string } {
  const prefix = randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8);
  const secret = randomToken(32);
  return { token: `qah_${prefix}_${secret}`, prefix, hash: sha256(secret) };
}

export function parseServiceAccountToken(
  token: string,
): { prefix: string; secretHash: string } | null {
  const m = SA_TOKEN.exec(token);
  return m ? { prefix: m[1]!, secretHash: sha256(m[2]!) } : null;
}
