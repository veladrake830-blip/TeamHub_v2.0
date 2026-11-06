import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.ts';

/** Random secrets are stored hashed, so a database leak does not expose usable tokens. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export interface AccessClaims {
  sub: string;
  sid: string;
}

/**
 * The token carries identity only, never roles or status. Those are read from the
 * database on each request, so removing access takes effect immediately.
 */
export function signAccessToken(userId: string, sessionId: string) {
  return jwt.sign({ sid: sessionId }, config.jwtSecret, {
    subject: userId,
    expiresIn: config.accessTokenSeconds,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const claims = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (typeof claims === 'string' || !claims.sub || typeof claims.sid !== 'string') return null;
    return { sub: claims.sub, sid: claims.sid };
  } catch {
    return null;
  }
}
