import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SuspendUserDto } from './suspend-user.dto';

describe('SuspendUserDto', () => {
  it('accepts an ISO expiry and trims a bounded reason', async () => {
    const dto = plainToInstance(SuspendUserDto, {
      suspendedUntil: '2026-10-06T12:00:00.000Z',
      reason: '  Compromised account  ',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.reason).toBe('Compromised account');
  });

  it('rejects invalid expiry and too-short reasons', async () => {
    const dto = plainToInstance(SuspendUserDto, {
      suspendedUntil: 'tomorrow',
      reason: 'x',
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property).sort()).toEqual([
      'reason',
      'suspendedUntil',
    ]);
  });
});
