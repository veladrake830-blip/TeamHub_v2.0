// Resets the Admin's password from the server's command line.
// Usage: npm run admin:reset-password -- "new password"
// With no argument, a random password is generated and printed once.
import { randomBytes } from 'node:crypto';
import { db } from '../db.ts';
import { audit } from '../lib/audit.ts';
import { hashPassword, passwordSchema } from '../lib/passwords.ts';
import { revokeAllSessions } from '../lib/sessions.ts';

const provided = process.argv[2];
const password = passwordSchema.parse(provided ?? randomBytes(15).toString('base64url'));
const passwordHash = await hashPassword(password);

const admin = await db.user.findFirst({ where: { isAdmin: true } });
if (!admin) {
  console.error('No Admin exists. Run `npm run db:seed` first.');
  process.exitCode = 1;
} else {
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: admin.id }, data: { passwordHash } });
    await revokeAllSessions(tx, admin.id);
    await audit(tx, { actor: null, action: 'ADMIN_PASSWORD_RESET_BY_SCRIPT', targetType: 'User', targetId: admin.id });
  });
  console.log(`Password reset for ${admin.email}. All Admin sessions have ended.`);
  if (!provided) console.log(`Generated password (shown once): ${password}`);
}
await db.$disconnect();
