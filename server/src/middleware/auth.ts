import type { NextFunction, Request, Response } from 'express';
import { db } from '../db.ts';
import { forbidden, unauthorized } from '../lib/errors.ts';
import type { Actor, Role } from '../lib/policy.ts';
import { verifyAccessToken } from '../lib/tokens.ts';

export interface AuthContext extends Actor {
  name: string;
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Checks the token, then re-reads the session, account status and team roles.
 * This query on every request is what makes deactivation, session revocation and
 * role changes take effect immediately instead of when the token expires.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const claims = header?.startsWith('Bearer ') ? verifyAccessToken(header.slice(7)) : null;
  if (!claims) throw unauthorized();

  const session = await db.session.findUnique({
    where: { id: claims.sid },
    include: { user: { include: { memberships: { select: { teamId: true, role: true } } } } },
  });
  if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt < new Date()) {
    throw unauthorized();
  }
  if (session.user.status !== 'ACTIVE') throw unauthorized();

  req.auth = {
    id: session.user.id,
    name: session.user.name,
    isAdmin: session.user.isAdmin,
    sessionId: session.id,
    teams: new Map(session.user.memberships.map((m) => [m.teamId, m.role as Role])),
  };
  next();
}

/** For handlers behind requireAuth. */
export function actor(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!actor(req).isAdmin) throw forbidden();
  next();
}
