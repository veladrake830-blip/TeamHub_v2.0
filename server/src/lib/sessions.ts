import { config } from '../config.ts';
import { db, type Tx } from '../db.ts';
import { unauthorized } from './errors.ts';
import { hashToken, newToken, signAccessToken } from './tokens.ts';

const DAY = 86_400_000;
const sessionEnded = () => unauthorized('Your session has ended. Please log in again.');

/** Sessions slide forward with use, but never past a fixed age, so a stolen one can't live forever. */
function nextExpiry(createdAt: Date, now: Date) {
  const sliding = now.getTime() + config.refreshTokenDays * DAY;
  const absolute = createdAt.getTime() + config.sessionMaxDays * DAY;
  return new Date(Math.min(sliding, absolute));
}

export async function createSession(tx: Tx, userId: string) {
  const refreshToken = newToken();
  const now = new Date();
  const session = await tx.session.create({
    data: { userId, refreshTokenHash: hashToken(refreshToken), expiresAt: nextExpiry(now, now) },
  });
  return { refreshToken, accessToken: signAccessToken(userId, session.id) };
}

/**
 * Swaps a refresh token for a new one. Every used token is remembered, because presenting any
 * of them means two parties hold the session, so the whole session ends. The exception is a
 * few seconds' grace, for two browser tabs refreshing at the same moment.
 */
export async function rotateSession(presented: string) {
  const hash = hashToken(presented);
  const now = new Date();

  const current = await db.session.findUnique({ where: { refreshTokenHash: hash }, include: { user: true } });
  if (!current) {
    const used = await db.usedRefreshToken.findUnique({ where: { tokenHash: hash } });
    if (used && now.getTime() - used.usedAt.getTime() > config.refreshReuseGraceSeconds * 1000) {
      await db.session.updateMany({ where: { id: used.sessionId, revokedAt: null }, data: { revokedAt: now } });
    }
    throw sessionEnded();
  }

  if (current.revokedAt || current.expiresAt <= now || current.user.status !== 'ACTIVE') throw sessionEnded();

  const refreshToken = newToken();
  await db.$transaction(async (tx) => {
    // The hash in the WHERE clause means that of two simultaneous refreshes, only one wins.
    const { count } = await tx.session.updateMany({
      where: { id: current.id, refreshTokenHash: hash },
      data: { refreshTokenHash: hashToken(refreshToken), expiresAt: nextExpiry(current.createdAt, now) },
    });
    if (count === 0) throw sessionEnded();
    await tx.usedRefreshToken.create({ data: { tokenHash: hash, sessionId: current.id, usedAt: now } });
  });

  return { refreshToken, accessToken: signAccessToken(current.userId, current.id) };
}

export function revokeAllSessions(tx: Tx, userId: string, exceptSessionId?: string) {
  return tx.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}
