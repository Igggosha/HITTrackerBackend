import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { eq } from "drizzle-orm";
import * as bcrypt from "bcrypt";


import { users } from "../db/schema";
import {db} from "../db/db";

@Injectable()
export class AuthService {
    constructor(
        private readonly jwtService: JwtService,
    ) {}

    async validateUser(
        email: string,
        password: string,
    ) {
        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

        if (!user) {
            throw new UnauthorizedException();
        }

        const valid = await bcrypt.compare(
            password,
            user.passwordHash,
        );

        if (!valid) {
            throw new UnauthorizedException();
        }

        return user;
    }


    async login(user: typeof users.$inferSelect) {
        return {
            accessToken: this.jwtService.sign({
                sub: user.id,
                email: user.email,
            }),
        };
    }
}