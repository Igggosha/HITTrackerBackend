import { createHash, randomBytes } from 'node:crypto';

export const ACCESS_TOKEN_TTL = '5m';
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const createRefreshToken = () => randomBytes(48).toString('base64url');

export const hashRefreshToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');
