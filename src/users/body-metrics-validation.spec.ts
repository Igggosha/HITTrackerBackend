import { BadRequestException } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import { createValidationPipe } from './body-metrics-validation';
import {
  CreateBodyMetricDto,
  ListBodyMetricsDto,
} from './dto/body-metrics.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

const pipe = createValidationPipe({ transform: true, whitelist: true });

async function responseFor(
  value: unknown,
  metatype: ArgumentMetadata['metatype'],
) {
  try {
    await pipe.transform(value, { type: 'body', metatype });
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse();
  }
  throw new Error('expected validation to fail');
}

describe('createValidationPipe', () => {
  it('keeps the default Nest error shape for other DTOs', async () => {
    await expect(responseFor({ age: 5 }, UpdateProfileDto)).resolves.toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: ['age must not be less than 13'],
    });
  });

  it('maps body-metric range violations to per-field details', async () => {
    await expect(
      responseFor({ weight: 10, waistCircumference: 300 }, CreateBodyMetricDto),
    ).resolves.toEqual({
      code: 'BODY_METRIC_OUT_OF_RANGE',
      details: [
        { field: 'weight', code: 'OUT_OF_RANGE', min: 20, max: 400 },
        {
          field: 'waistCircumference',
          code: 'OUT_OF_RANGE',
          min: 30,
          max: 250,
        },
      ],
    });
  });

  it('maps an invalid recordedAt and a non-numeric value to codes', async () => {
    await expect(
      responseFor({ weight: 70, recordedAt: 'yesterday' }, CreateBodyMetricDto),
    ).resolves.toEqual({ code: 'BODY_METRIC_INVALID_DATE' });
    await expect(
      responseFor({ weight: 'abc' }, CreateBodyMetricDto),
    ).resolves.toEqual({
      code: 'BODY_METRIC_OUT_OF_RANGE',
      details: [{ field: 'weight', code: 'OUT_OF_RANGE', min: 20, max: 400 }],
    });
  });

  it('maps an invalid period query to INVALID_PERIOD', async () => {
    await expect(
      responseFor({ from: 'nope' }, ListBodyMetricsDto),
    ).resolves.toEqual({ code: 'INVALID_PERIOD' });
  });
});
