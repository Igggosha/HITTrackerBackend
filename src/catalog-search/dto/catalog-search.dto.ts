// EN: Validates normalized search text, section, scope, muscle filter, and bounded result count at the HTTP boundary.
// UK: Перевіряє нормалізований пошуковий текст, розділ, область, фільтр м'язів і обмежену кількість результатів на HTTP-межі.

import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CatalogSearchDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @MaxLength(120)
  q = '';

  @IsIn(['programs', 'exercises'])
  section!: 'programs' | 'exercises';

  @IsOptional()
  @IsIn(['all', 'official', 'personal', 'saved'])
  scope: 'all' | 'official' | 'personal' | 'saved' = 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  muscle?: number;

  @IsOptional()
  @IsIn(['relevance', 'popular', 'newest', 'alphabetical'])
  sort: 'relevance' | 'popular' | 'newest' | 'alphabetical' = 'relevance';

  @IsOptional()
  @IsIn(['en', 'uk'])
  locale: 'en' | 'uk' = 'en';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 25;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
