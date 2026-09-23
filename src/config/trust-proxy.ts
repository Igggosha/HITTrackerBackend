import type { Express } from 'express';

export function configureTrustProxy(app: Express, production: boolean): void {
  if (production) app.set('trust proxy', 1);
}
