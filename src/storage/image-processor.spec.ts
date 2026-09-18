import sharp from 'sharp';
import {
  processImage,
  PROCESSED_IMAGE_CONTENT_TYPE,
  PROCESSED_IMAGE_EXTENSION,
} from './image-processor';

describe('image processing', () => {
  it('crops, re-encodes and strips source metadata', async () => {
    const input = await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 3,
        background: '#336699',
      },
    })
      .withMetadata({ orientation: 6 })
      .png()
      .toBuffer();

    const processed = await processImage(input, {
      maxDimension: 64,
      quality: 82,
      square: true,
    });
    const metadata = await sharp(processed.buffer).metadata();

    expect(processed).toMatchObject({
      contentType: PROCESSED_IMAGE_CONTENT_TYPE,
      extension: PROCESSED_IMAGE_EXTENSION,
      width: 64,
      height: 64,
    });
    expect(metadata).toMatchObject({ format: 'webp', width: 64, height: 64 });
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });
});
