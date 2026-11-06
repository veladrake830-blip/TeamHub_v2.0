import { z } from 'zod';

export const nameSchema = z.string().trim().min(1, 'Name is required.').max(100);
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')).pipe(z.string().max(254));
export const sloganSchema = z.string().trim().max(200);
export const idSchema = z.uuid('Invalid id.');

export const pageSchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

/** Express 5 types route params as string | string[]. */
export const param = (value: unknown) => idSchema.parse(value);
