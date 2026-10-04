import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @IsOptional()
  fullName?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @IsOptional()
  displayName?: string;

  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(12, { message: 'Password must be at least 12 characters long' })
  @MaxLength(128)
  password!: string;
}

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsOptional()
  @IsIn(['web', 'native'])
  client?: 'web' | 'native';
}

export class RefreshSessionDto {
  @IsOptional()
  @IsString()
  @MinLength(32)
  refreshToken?: string;
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
  @MinLength(12, { message: 'Password must be at least 12 characters long' })
  @MaxLength(128)
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

export class MfaChallengeDto {
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  challengeToken!: string;
}

export class MfaVerifyDto extends MfaChallengeDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(32)
  recoveryCode?: string;

  @IsOptional()
  @IsIn(['web', 'native'])
  client?: 'web' | 'native';
}

export class MfaCodeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}
