import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StorageService } from './storage.service';

const ONBOARDING_IMAGE_KEYS = {
  community: 'uploads/onboarding/onboarding-community.png',
  goal: 'uploads/onboarding/onboarding-goal.png',
  progress: 'uploads/onboarding/onboarding-progress.png',
} as const;

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly storage: StorageService) {}

  @Get(':image')
  async image(@Param('image') image: string): Promise<{ url: string }> {
    const key =
      ONBOARDING_IMAGE_KEYS[image as keyof typeof ONBOARDING_IMAGE_KEYS];
    if (!key) throw new NotFoundException();

    const url = await this.storage.getUrl(key);
    if (!url) {
      throw new ServiceUnavailableException({
        code: 'STORAGE_UNAVAILABLE',
        message: 'Onboarding image storage is unavailable',
      });
    }
    return { url };
  }
}
