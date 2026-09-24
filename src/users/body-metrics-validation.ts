import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationPipeOptions } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { BODY_METRIC_RANGES } from './body-metrics';
import {
  CreateBodyMetricDto,
  ListBodyMetricsDto,
} from './dto/body-metrics.dto';

// Body-metric routes answer with machine-readable codes the mobile app localises.
// Returns null for every other DTO so the default Nest error shape is kept.
export function bodyMetricValidationException(
  errors: ValidationError[],
): BadRequestException | null {
  const target = errors.find((error) => error.target)?.target;

  if (target instanceof ListBodyMetricsDto) {
    return new BadRequestException({ code: 'INVALID_PERIOD' });
  }
  if (!(target instanceof CreateBodyMetricDto)) return null;

  const details = errors.flatMap((error) => {
    const range =
      BODY_METRIC_RANGES[error.property as keyof typeof BODY_METRIC_RANGES];
    const isRangeError = Object.keys(error.constraints ?? {}).some((key) =>
      ['min', 'max'].includes(key),
    );
    return range && isRangeError
      ? [
          {
            field: error.property,
            code: 'OUT_OF_RANGE',
            min: range.min,
            max: range.max,
          },
        ]
      : [];
  });
  if (details.length) {
    return new BadRequestException({
      code: 'BODY_METRIC_OUT_OF_RANGE',
      details,
    });
  }
  if (errors.some((error) => error.property === 'recordedAt')) {
    return new BadRequestException({ code: 'BODY_METRIC_INVALID_DATE' });
  }
  return new BadRequestException({ code: 'BODY_METRIC_INVALID' });
}

export function createValidationPipe(options: ValidationPipeOptions) {
  const defaultExceptionFactory = new ValidationPipe(
    options,
  ).createExceptionFactory();
  return new ValidationPipe({
    ...options,
    exceptionFactory: (errors: ValidationError[]) =>
      bodyMetricValidationException(errors) ?? defaultExceptionFactory(errors),
  });
}
