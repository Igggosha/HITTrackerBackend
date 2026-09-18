import { StorageService } from './storage.service';
import type { StorageConfig } from './storage.config';
import sharp from 'sharp';

// `jest.mock` is hoisted above these declarations, so a factory must reach the
// doubles lazily -- reading them while the factory body runs would hit the
// temporal dead zone. The names must start with "mock" for the same reason.
const mockSend = jest.fn<Promise<unknown>, [unknown]>();
const mockGetSignedUrl = jest.fn<Promise<string>, unknown[]>();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({
    send: (command: unknown) => mockSend(command),
  })),
  PutObjectCommand: jest.fn((input: unknown) => ({ input })),
  DeleteObjectCommand: jest.fn((input: unknown) => ({ input })),
  GetObjectCommand: jest.fn((input: unknown) => ({ input })),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

const config: StorageConfig = {
  endpoint: 'http://minio:9000',
  publicEndpoint: 'https://files.example.com',
  region: 'us-east-1',
  bucket: 'hit-tracker',
  accessKeyId: 'hit-tracker-api',
  secretAccessKey: 'storage-secret',
  forcePathStyle: true,
  uploadPrefix: 'uploads',
  tempPrefix: 'tmp',
  presignedUrlTtlSeconds: 900,
  maxUploadBytes: 1024 * 1024,
  avatarMaxDimension: 512,
  exerciseImageMaxDimension: 1280,
  imageQuality: 82,
};

describe('StorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockGetSignedUrl.mockResolvedValue('https://files.example.com/signed');
  });

  describe('when storage is not configured', () => {
    const service = new StorageService(null);

    it('reports itself as disabled instead of failing at boot', () => {
      expect(service.isEnabled).toBe(false);
    });

    it('answers 503 rather than 500 for an upload', async () => {
      await expect(
        service.uploadImage({
          scope: 'avatars',
          ownerId: 1,
          file: { buffer: Buffer.from('x') },
          maxDimension: 512,
        }),
      ).rejects.toMatchObject({
        status: 503,
        response: { code: 'STORAGE_UNAVAILABLE' },
      });
    });

    it('treats every key as having no URL', async () => {
      await expect(
        service.getUrl('uploads/avatars/1/a.webp'),
      ).resolves.toBeNull();
    });
  });

  describe('when storage is configured', () => {
    const service = new StorageService(config);

    it('re-encodes and uploads a valid image under a fresh managed key', async () => {
      const buffer = await sharp({
        create: {
          width: 120,
          height: 80,
          channels: 3,
          background: '#336699',
        },
      })
        .png()
        .toBuffer();

      const stored = await service.uploadImage({
        scope: 'avatars',
        ownerId: 7,
        file: { buffer, size: buffer.length, mimetype: 'image/png' },
        maxDimension: 64,
        square: true,
      });

      expect(stored).toMatchObject({ width: 64, height: 64 });
      expect(stored.key).toMatch(/^uploads\/avatars\/7\/[0-9a-f-]{36}\.webp$/);
      expect(mockSend.mock.calls[0][0]).toMatchObject({
        input: {
          Bucket: 'hit-tracker',
          Key: stored.key,
          ContentType: 'image/webp',
        },
      });
    });

    it('signs a download URL for a managed key', async () => {
      await expect(service.getUrl('uploads/avatars/1/a.webp')).resolves.toBe(
        'https://files.example.com/signed',
      );
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          input: { Bucket: 'hit-tracker', Key: 'uploads/avatars/1/a.webp' },
        }),
        { expiresIn: 900 },
      );
    });

    it('returns null without signing a key outside the managed prefixes', async () => {
      await expect(service.getUrl('secrets/id_rsa')).resolves.toBeNull();
      await expect(service.getUrl(null)).resolves.toBeNull();
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it('refuses to delete an object outside the managed prefixes', async () => {
      await service.remove('secrets/id_rsa');
      expect(mockSend).not.toHaveBeenCalled();

      await service.remove('uploads/avatars/1/a.webp');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('swallows a failed cleanup so the request that succeeded still returns', async () => {
      mockSend.mockRejectedValueOnce(new Error('connection reset'));
      await expect(
        service.remove('uploads/avatars/1/a.webp'),
      ).resolves.toBeUndefined();
    });

    it('rejects a payload whose bytes are not a supported image', async () => {
      await expect(
        service.uploadImage({
          scope: 'avatars',
          ownerId: 1,
          file: {
            buffer: Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
            ),
          },
          maxDimension: 512,
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: 'UNSUPPORTED_IMAGE_TYPE' },
      });
      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});
