import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import type { StorageService } from './storage.service';

describe('OnboardingController', () => {
  const getUrl = jest.fn();
  const controller = new OnboardingController({
    getUrl,
  } as unknown as StorageService);

  beforeEach(() => getUrl.mockReset());

  it.each([
    ['goal', 'uploads/onboarding/onboarding-goal.png'],
    ['progress', 'uploads/onboarding/onboarding-progress.png'],
    ['community', 'uploads/onboarding/onboarding-community.png'],
  ])('signs the allowlisted %s image', async (image, key) => {
    getUrl.mockResolvedValue('https://files.example.com/signed');

    await expect(controller.image(image)).resolves.toEqual({
      url: 'https://files.example.com/signed',
    });
    expect(getUrl).toHaveBeenCalledWith(key);
  });

  it('rejects unknown image names before storage access', async () => {
    await expect(controller.image('../secret')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(getUrl).not.toHaveBeenCalled();
  });

  it('returns 503 when storage cannot provide the image', async () => {
    getUrl.mockResolvedValue(null);
    await expect(controller.image('goal')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
