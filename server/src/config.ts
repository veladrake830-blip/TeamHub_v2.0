function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function jwtSecret(): string {
  const value = required('JWT_SECRET');
  if (value === 'change-me' || value.length < 32) {
    throw new Error('JWT_SECRET must be a long random value. Generate one with: openssl rand -hex 32');
  }
  return value;
}

/** Hops of reverse proxy in front of the app. Without this, every user appears to share one IP. */
const trustProxyHops = Number(process.env.TRUST_PROXY ?? 0);
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) throw new Error('TRUST_PROXY must be a whole number.');

export const config = {
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: jwtSecret(),
  trustProxyHops,
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  port: Number(process.env.PORT ?? 4000),
  /** Set to 127.0.0.1 behind a reverse proxy, so nothing can reach the app directly. */
  host: process.env.HOST,
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  bcryptCost: Number(process.env.BCRYPT_COST ?? 12),
  accessTokenSeconds: 15 * 60,
  refreshTokenDays: 14,
  sessionMaxDays: 30,
  /** How long after losing a TeamLeader role that only the Admin can issue a user a reset link. */
  resetLockDays: 7,
  resetLinkHours: 24,
  /** A replayed refresh token inside this window is treated as a race between tabs, not theft. */
  refreshReuseGraceSeconds: 10,
  rateLimitEnabled: process.env.RATE_LIMIT !== 'off',
};
