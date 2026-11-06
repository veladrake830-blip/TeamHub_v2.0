import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import multer from 'multer';
import { config } from '../config.ts';
import { badRequest } from './errors.ts';

export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
}).single('avatar');

const avatarDir = () => resolve(config.uploadDir, 'avatars');

/** The type comes from the file's own bytes, never from the name or header the browser sent. */
function detectExtension(data: Buffer): string | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpg';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'webp';
  }
  return null;
}

export async function saveAvatar(file: Express.Multer.File | undefined): Promise<string> {
  if (!file) throw badRequest('Choose an image to upload.');
  const extension = detectExtension(file.buffer);
  if (!extension) throw badRequest('Avatar must be a PNG, JPEG or WebP image.');
  await mkdir(avatarDir(), { recursive: true });
  const name = `${randomUUID()}.${extension}`;
  await writeFile(join(avatarDir(), name), file.buffer);
  return name;
}

export async function removeAvatar(name: string | null) {
  if (name) await rm(join(avatarDir(), basename(name)), { force: true });
}

export const avatarUrl = (name: string | null) => (name ? `/uploads/avatars/${name}` : null);
