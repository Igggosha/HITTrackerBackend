import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(13)
  @Max(120)
  age?: number;

  @IsOptional()
  @IsIn(['female', 'male'])
  gender?: 'female' | 'male';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(50)
  @Max(300)
  height?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  goal?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(20)
  @Max(500)
  weight?: number;
}
