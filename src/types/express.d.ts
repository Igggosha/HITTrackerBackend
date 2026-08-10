declare global {
    namespace Express {
        interface User {
            id: number;
            email: string;
            googleId?: string;
        }
    }
}

export {};