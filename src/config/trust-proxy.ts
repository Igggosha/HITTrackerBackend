// EN: Trusts exactly the first reverse-proxy hop in production so forwarded protocol and client data are interpreted safely.
// UK: У production довіряє лише першому зворотному проксі, щоб безпечно тлумачити переданий протокол і дані клієнта.

import type { Express } from 'express';

export function configureTrustProxy(app: Express, production: boolean): void {
  if (production) app.set('trust proxy', 1);
}
