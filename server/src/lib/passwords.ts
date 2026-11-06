import bcrypt from 'bcrypt';
import { z } from 'zod';
import { config } from '../config.ts';

export const hashPassword = (password: string) => bcrypt.hash(password, config.bcryptCost);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

/** Compared against when no account matches, so response time does not reveal which emails exist. */
const dummyHash = bcrypt.hashSync('teamhub-no-such-account', config.bcryptCost);
export const burnPasswordCheck = (password: string) => bcrypt.compare(password, dummyHash);

// bcrypt ignores everything past 72 bytes, so longer passwords are rejected rather than truncated.
export const passwordSchema = z
  .string()
  .min(8, 'Password must have at least 8 characters.')
  .refine((value) => Buffer.byteLength(value) <= 72, 'Password must be at most 72 bytes.');
