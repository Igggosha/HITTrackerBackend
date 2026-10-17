// EN: Provides the reusable NestJS guard that requires a valid access JWT on protected routes.
// UK: Надає багаторазовий guard NestJS, який вимагає чинний access JWT на захищених маршрутах.

import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtGuard extends AuthGuard('jwt') {}
