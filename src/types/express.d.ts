// EN: Extends Express and session types with the authenticated principal and mobile OAuth PKCE state shared across modules.
// UK: Розширює типи Express і сесії даними автентифікованого користувача та станом mobile OAuth PKCE, спільним для модулів.

import type { UserRole } from '../db/schema';

declare global {
  namespace Express {
    interface User {
      id?: number;
      userId?: number;
      email: string;
      googleId?: string;
      role?: UserRole;
      mfaVerified?: boolean;
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    oauthPlatform?: 'mobile';
    oauthCodeChallenge?: string;
  }
}

export {};
