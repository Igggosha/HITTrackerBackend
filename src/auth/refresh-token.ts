// EN: Defines access and refresh lifetimes and generates high-entropy refresh tokens whose database form is only a hash.
// UK: Визначає строки дії access і refresh-токенів та створює високоентропійні refresh-токени, що зберігаються лише як хеш.

import { createHash, randomBytes } from 'node:crypto';

export const ACCESS_TOKEN_TTL = '5m';
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const createRefreshToken = () => randomBytes(48).toString('base64url');

export const hashRefreshToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');
