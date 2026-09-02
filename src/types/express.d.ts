import type { UserRole } from '../db/schema';

declare global {
    namespace Express {
        interface User {
            id?: number;
            email: string;
            googleId?: string;
            role?: UserRole;
        }
    }
}

export {};
