declare global {
    namespace Express {
        interface User {
            id?: number;
            email: string;
            googleId?: string;
        }
    }
}

declare module 'express-session' {
    interface SessionData {
        oauthPlatform?: 'mobile';
    }
}

export {};
