import { IsEmail, IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password!: string;
}

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  newPassword!: string;
}

export class VerifyRegistrationDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'Verification code must contain 6 digits' })
  code!: string;
}

export class ExchangeOAuthCodeDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(43)
  codeVerifier!: string;
}
