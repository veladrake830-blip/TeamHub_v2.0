import type { Request } from 'express';
import { Prisma, type Tx } from '../db.ts';

export interface AuditEntry {
  actor: { id: string; name: string } | null;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Prisma.InputJsonValue;
  ip?: string;
}

/** Always call this with the transaction that makes the change, so both commit or neither does. */
export function audit(tx: Tx, entry: AuditEntry) {
  return tx.auditLog.create({
    data: {
      actorId: entry.actor?.id ?? null,
      actorName: entry.actor?.name ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      details: entry.details ?? Prisma.JsonNull,
      ip: entry.ip ?? null,
    },
  });
}

export const clientIp = (req: Request) => req.ip ?? undefined;
