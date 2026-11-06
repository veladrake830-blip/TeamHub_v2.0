import { config } from '../config.ts';
import type { Tx } from '../db.ts';
import { canIssueResetLink, type Role } from './policy.ts';
import { hashToken, newToken } from './tokens.ts';

/**
 * The token sits in the URL fragment, which browsers never send to a server, so it can't
 * end up in the access logs of a reverse proxy.
 */
export async function issueResetLink(
  tx: Tx,
  userId: string,
  issuedById: string | null,
  purpose: 'RESET' | 'FIRST_PASSWORD' = 'RESET',
) {
  await revokeResetLinks(tx, userId);
  const token = newToken();
  const expiresAt = new Date(Date.now() + config.resetLinkHours * 3_600_000);
  await tx.passwordResetToken.create({
    data: { userId, issuedById, purpose, tokenHash: hashToken(token), expiresAt },
  });
  return { url: `${config.publicUrl}/reset-password#${token}`, expiresAt };
}

export function revokeResetLinks(tx: Tx, userId: string) {
  return tx.passwordResetToken.updateMany({
    where: { userId, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

const rolesOf = (memberships: { teamId: string; role: Role }[]) =>
  new Map(memberships.map((m) => [m.teamId, m.role]));

/**
 * Finds a link that can still be used. Permission is checked again here, because a link can
 * outlive the situation it was issued in: the user may have become a TeamLeader since, or the
 * issuer may have lost their role.
 */
export async function findUsableLink(tx: Tx, token: string) {
  const link = await tx.passwordResetToken.findFirst({
    where: { tokenHash: hashToken(token), usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: { include: { memberships: true } } },
  });
  if (!link) return null;

  // First-password links come from the Admin, and script-issued links have no issuer.
  if (link.purpose === 'FIRST_PASSWORD' || !link.issuedById) return link;

  const issuer = await tx.user.findUnique({ where: { id: link.issuedById }, include: { memberships: true } });
  if (!issuer || issuer.status !== 'ACTIVE') return null;

  const allowed = canIssueResetLink(
    { id: issuer.id, isAdmin: issuer.isAdmin, teams: rolesOf(issuer.memberships) },
    {
      id: link.user.id,
      isAdmin: link.user.isAdmin,
      status: link.user.status,
      teams: rolesOf(link.user.memberships),
      resetLockedUntil: link.user.resetLockedUntil,
    },
  );
  return allowed ? link : null;
}
