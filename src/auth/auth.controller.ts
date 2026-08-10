import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, GoogleUser } from './auth.service';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from './dto/auth.dto';
import { GoogleAuthGuard } from './google-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {}

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleAuthCallback(
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const result = await this.authService.loginWithGoogle(request.user as GoogleUser);
    const redirectUrl = process.env.OAUTH_SUCCESS_REDIRECT_URL;

    if (!redirectUrl) {
      return response.json(result);
    }

    const url = new URL(redirectUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.hash = new URLSearchParams({ accessToken: result.accessToken }).toString();
    } else {
      url.searchParams.set('accessToken', result.accessToken);
    }
    return response.redirect(url.toString());
  }
}