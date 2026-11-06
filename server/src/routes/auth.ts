import { Router, type CookieOptions, type Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.ts';
import { db, Prisma } from '../db.ts';
import { audit, clientIp } from '../lib/audit.ts';
import { ApiError, badRequest, unauthorized } from '../lib/errors.ts';
import { burnPasswordCheck, hashPassword, passwordSchema, verifyPassword } from '../lib/passwords.ts';
import { findUsableLink } from '../lib/resetLinks.ts';
import { emailSchema, nameSchema } from '../lib/schemas.ts';
import { createSession, revokeAllSessions, rotateSession } from '../lib/sessions.ts';
import { hashToken } from '../lib/tokens.ts';
import { actor, requireAuth } from '../middleware/auth.ts';
import { avatarUrl } from '../lib/avatars.ts';

export const authRouter = Router();

const COOKIE = 'teamhub_refresh';
const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: config.cookieSecure,
  path: '/api/auth',
};
const setRefreshCookie = (res: Response, token: string) =>
  res.cookie(COOKIE, token, { ...cookieOptions, maxAge: config.refreshTokenDays * 86_400_000 });

const limiterDefaults = {
  windowMs: 15 * 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !config.rateLimitEnabled,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' } },
};

// An office usually shares one IP address, so limits per address alone would lock out everyone.
// Guessing is limited per account, and the address limit is only a ceiling on wide attacks.
const accountLimiter = rateLimit({
  ...limiterDefaults,
  limit: 10,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return `${ipKeyGenerator(req.ip ?? '')}|${email}`;
  },
});
const addressLimiter = rateLimit({ ...limiterDefaults, limit: 300 });

// strictObject rejects unknown keys, so a request carrying `role` or `isAdmin` fails outright.
const registerBody = z.strictObject({ name: nameSchema, email: emailSchema, password: passwordSchema });

authRouter.post('/register', addressLimiter, async (req, res) => {
  const body = registerBody.parse(req.body);
  const passwordHash = await hashPassword(body.password);
  try {
    await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name: body.name, email: body.email, passwordHash } });
      await audit(tx, {
        actor: { id: user.id, name: user.name },
        action: 'ACCOUNT_REGISTERED',
        targetType: 'User',
        targetId: user.id,
        ip: clientIp(req),
      });
    });
  } catch (err) {
    // A taken email gets the same answer, so this form can't reveal who has an account.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
  }
  res.status(201).json({ status: 'PENDING' });
});

const loginBody = z.strictObject({ email: emailSchema, password: z.string().min(1).max(200) });

authRouter.post('/login', addressLimiter, accountLimiter, async (req, res) => {
  const { email, password } = loginBody.parse(req.body);
  const user = await db.user.findUnique({ where: { email } });

  const passwordOk = user?.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : (await burnPasswordCheck(password), false);

  if (!user || !passwordOk) {
    await audit(db, { actor: null, action: 'LOGIN_FAILED', details: { email }, ip: clientIp(req) });
    throw new ApiError(401, 'BAD_CREDENTIALS', 'Incorrect email or password.');
  }
  // Status is checked only after the password, so it is not revealed to anyone without it.
  if (user.status === 'PENDING') {
    throw new ApiError(403, 'ACCOUNT_PENDING', 'Your account is waiting for the Admin to activate it.');
  }
  if (user.status === 'DEACTIVATED') {
    throw new ApiError(403, 'ACCOUNT_DEACTIVATED', 'This account has been deactivated.');
  }

  const tokens = await db.$transaction(async (tx) => {
    const created = await createSession(tx, user.id);
    await audit(tx, {
      actor: { id: user.id, name: user.name },
      action: 'LOGIN',
      targetType: 'User',
      targetId: user.id,
      ip: clientIp(req),
    });
    return created;
  });
  setRefreshCookie(res, tokens.refreshToken);
  res.json({ accessToken: tokens.accessToken });
});

authRouter.post('/refresh', async (req, res) => {
  const presented = req.cookies?.[COOKIE];
  if (typeof presented !== 'string') throw unauthorized();
  const tokens = await rotateSession(presented);
  setRefreshCookie(res, tokens.refreshToken);
  res.json({ accessToken: tokens.accessToken });
});

authRouter.post('/logout', async (req, res) => {
  const presented = req.cookies?.[COOKIE];
  if (typeof presented === 'string') {
    await db.session.updateMany({
      where: { refreshTokenHash: hashToken(presented), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  res.clearCookie(COOKIE, cookieOptions);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await db.user.findUniqueOrThrow({
    where: { id: actor(req).id },
    include: { memberships: { include: { team: { select: { id: true, name: true, avatarPath: true } } } } },
  });
  const pendingInvitations = await db.invitation.count({ where: { userId: user.id, status: 'PENDING' } });
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    slogan: user.slogan,
    avatarUrl: avatarUrl(user.avatarPath),
    isAdmin: user.isAdmin,
    theme: user.theme,
    passwordResetNoticeAt: user.resetNoticeAt,
    pendingInvitations,
    teams: user.memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      avatarUrl: avatarUrl(m.team.avatarPath),
      role: m.role,
    })),
  });
});

authRouter.post('/me/dismiss-reset-notice', requireAuth, async (req, res) => {
  await db.user.update({ where: { id: actor(req).id }, data: { resetNoticeAt: null } });
  res.status(204).end();
});

const tokenBody = z.strictObject({ token: z.string().min(1).max(200) });

authRouter.post('/password-reset/check', addressLimiter, async (req, res) => {
  const { token } = tokenBody.parse(req.body);
  const link = await findUsableLink(db, token);
  if (!link) throw badRequest('This link is invalid or has expired.');
  res.json({ name: link.user.name, purpose: link.purpose });
});

const completeBody = z.strictObject({ token: z.string().min(1).max(200), password: passwordSchema });

authRouter.post('/password-reset/complete', addressLimiter, async (req, res) => {
  const { token, password } = completeBody.parse(req.body);
  const passwordHash = await hashPassword(password);

  await db.$transaction(async (tx) => {
    const link = await findUsableLink(tx, token);
    if (!link || link.user.status !== 'ACTIVE') throw badRequest('This link is invalid or has expired.');

    // Conditional update, so that a link used twice at the same moment still works only once.
    const { count } = await tx.passwordResetToken.updateMany({
      where: { id: link.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count !== 1) throw badRequest('This link is invalid or has expired.');

    await tx.user.update({
      where: { id: link.userId },
      data: { passwordHash, resetNoticeAt: link.purpose === 'RESET' ? new Date() : undefined },
    });
    await revokeAllSessions(tx, link.userId);
    await audit(tx, {
      actor: { id: link.user.id, name: link.user.name },
      action: 'PASSWORD_RESET_LINK_USED',
      targetType: 'User',
      targetId: link.userId,
      details: { linkId: link.id, issuedById: link.issuedById, purpose: link.purpose },
      ip: clientIp(req),
    });
  });
  res.status(204).end();
});
