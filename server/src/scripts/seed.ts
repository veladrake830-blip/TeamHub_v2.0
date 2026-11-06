// Creates the single Admin account. Safe to run again: it does nothing if an Admin exists.
import { randomBytes } from 'node:crypto';
import { db } from '../db.ts';
import { audit } from '../lib/audit.ts';
import { hashPassword, passwordSchema } from '../lib/passwords.ts';
import { emailSchema, nameSchema } from '../lib/schemas.ts';

const existing = await db.user.findFirst({ where: { isAdmin: true } });
if (existing) {
  console.log(`Admin already exists: ${existing.email}`);
} else {
  const name = nameSchema.parse(process.env.ADMIN_NAME ?? 'Admin');
  const email = emailSchema.parse(process.env.ADMIN_EMAIL ?? 'admin@teamhub.local');
  const provided = process.env.ADMIN_PASSWORD;
  const password = passwordSchema.parse(provided || randomBytes(15).toString('base64url'));
  const passwordHash = await hashPassword(password);

  await db.$transaction(async (tx) => {
    const admin = await tx.user.create({
      data: { name, email, passwordHash, isAdmin: true, status: 'ACTIVE' },
    });
    await audit(tx, { actor: null, action: 'ADMIN_SEEDED', targetType: 'User', targetId: admin.id });
  });

  console.log(`Admin created: ${email}`);
  if (!provided) console.log(`Generated password (shown once): ${password}`);
}
await db.$disconnect();
