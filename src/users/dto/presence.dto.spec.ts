import { validate } from 'class-validator';
import { PresenceDto } from './presence.dto';

describe('PresenceDto', () => {
  it('accepts legacy heartbeats and complete installation details', async () => {
    expect(await validate(new PresenceDto())).toHaveLength(0);
    expect(
      await validate(
        Object.assign(new PresenceDto(), {
          installationId: '328f90c4-7fa6-46d6-8cb6-1ba743b3c1a2',
          platform: 'android',
        }),
      ),
    ).toHaveLength(0);
  });

  it('rejects partial and malformed installation details', async () => {
    expect(
      await validate(Object.assign(new PresenceDto(), { platform: 'android' })),
    ).not.toHaveLength(0);
    expect(
      await validate(
        Object.assign(new PresenceDto(), {
          installationId: 'not-a-uuid',
          platform: 'android',
        }),
      ),
    ).not.toHaveLength(0);
  });
});
