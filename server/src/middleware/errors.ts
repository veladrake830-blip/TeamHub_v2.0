import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { Prisma } from '../db.ts';
import { ApiError } from '../lib/errors.ts';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const field = issue?.path.join('.');
    const message = issue?.code === 'unrecognized_keys' ? 'Unexpected field in request.' : issue?.message;
    return res.status(400).json({ error: { code: 'VALIDATION', message, field } });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: { code: 'UPLOAD', message: 'Image must be 2 MB or smaller.' } });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return res.status(409).json({ error: { code: 'DUPLICATE', message: 'That value is already in use.' } });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Invalid JSON.' } });
  }
  console.error(err);
  return res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Something went wrong.' } });
}
