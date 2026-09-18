import {
  isStorageConfigured,
  readStorageConfig,
  validateStorageEnvironment,
} from './storage.config';

const configuredEnvironment: NodeJS.ProcessEnv = {
  S3_ENDPOINT: 'http://minio:9000',
  S3_BUCKET: 'hit-tracker',
  S3_ACCESS_KEY_ID: 'hit-tracker-api',
  S3_SECRET_ACCESS_KEY: 'a-real-storage-secret',
};

describe('storage configuration', () => {
  it('treats a missing bucket as storage being switched off', () => {
    expect(isStorageConfigured({})).toBe(false);
    expect(isStorageConfigured({ S3_BUCKET: '   ' })).toBe(false);
    expect(() => validateStorageEnvironment({})).not.toThrow();
  });

  it('applies defaults once a bucket is configured', () => {
    const config = readStorageConfig(configuredEnvironment);

    expect(config.region).toBe('us-east-1');
    expect(config.uploadPrefix).toBe('uploads');
    expect(config.tempPrefix).toBe('tmp');
    expect(config.presignedUrlTtlSeconds).toBe(900);
    expect(config.maxUploadBytes).toBe(10 * 1024 * 1024);
    expect(config.forcePathStyle).toBe(true);
    // Clients reach MinIO at the same URL unless a public one is configured.
    expect(config.publicEndpoint).toBe('http://minio:9000');
  });

  it('signs presigned URLs for the public endpoint when one is given', () => {
    const config = readStorageConfig({
      ...configuredEnvironment,
      S3_PUBLIC_ENDPOINT: 'https://files.example.com/',
    });

    expect(config.endpoint).toBe('http://minio:9000');
    // A trailing slash would double up against the bucket path.
    expect(config.publicEndpoint).toBe('https://files.example.com');
  });

  it('rejects placeholder or root credentials', () => {
    expect(() =>
      readStorageConfig({
        ...configuredEnvironment,
        S3_SECRET_ACCESS_KEY: 'change_me',
      }),
    ).toThrow('S3_SECRET_ACCESS_KEY');
    expect(() =>
      readStorageConfig({
        ...configuredEnvironment,
        S3_SECRET_ACCESS_KEY: 'change_me_storage_secret',
      }),
    ).toThrow('S3_SECRET_ACCESS_KEY');
    expect(() =>
      readStorageConfig({
        ...configuredEnvironment,
        S3_ACCESS_KEY_ID: 'minioadmin',
      }),
    ).toThrow('S3_ACCESS_KEY_ID');
    expect(() =>
      readStorageConfig({
        ...configuredEnvironment,
        S3_SECRET_ACCESS_KEY: '',
      }),
    ).toThrow('S3_SECRET_ACCESS_KEY');
    expect(() =>
      readStorageConfig({
        ...configuredEnvironment,
        MINIO_ROOT_USER: 'custom-root',
        S3_ACCESS_KEY_ID: 'custom-root',
      }),
    ).toThrow('S3_ACCESS_KEY_ID');
  });

  it('rejects an endpoint that is not an absolute http(s) URL', () => {
    expect(() =>
      readStorageConfig({
        ...configuredEnvironment,
        S3_ENDPOINT: 'minio:9000',
      }),
    ).toThrow('S3_ENDPOINT');
    expect(() =>
      readStorageConfig({
        ...configuredEnvironment,
        S3_ENDPOINT: 'ftp://minio:9000',
      }),
    ).toThrow('S3_ENDPOINT');
  });

  it('rejects bucket and prefix names the bucket policy could not express', () => {
    expect(() =>
      readStorageConfig({ ...configuredEnvironment, S3_BUCKET: 'Hit_Tracker' }),
    ).toThrow('S3_BUCKET');
    expect(() =>
      readStorageConfig({ ...configuredEnvironment, S3_BUCKET: '192.168.1.1' }),
    ).toThrow('S3_BUCKET');
    expect(() =>
      readStorageConfig({
        ...configuredEnvironment,
        S3_BUCKET: 'hit..tracker',
      }),
    ).toThrow('S3_BUCKET');
    expect(() =>
      readStorageConfig({
        ...configuredEnvironment,
        S3_UPLOAD_PREFIX: '../escape',
      }),
    ).toThrow('S3_UPLOAD_PREFIX');
    expect(() =>
      readStorageConfig({
        ...configuredEnvironment,
        S3_UPLOAD_PREFIX: 'shared',
        S3_TEMP_PREFIX: 'shared',
      }),
    ).toThrow('must differ');
  });

  it('keeps numeric limits inside a sane range', () => {
    expect(() =>
      readStorageConfig({
        ...configuredEnvironment,
        S3_PRESIGNED_URL_TTL_SECONDS: '30',
      }),
    ).toThrow('S3_PRESIGNED_URL_TTL_SECONDS');
    // SigV4 cannot sign a URL that outlives seven days.
    expect(() =>
      readStorageConfig({
        ...configuredEnvironment,
        S3_PRESIGNED_URL_TTL_SECONDS: '604801',
      }),
    ).toThrow('S3_PRESIGNED_URL_TTL_SECONDS');
    expect(() =>
      readStorageConfig({
        ...configuredEnvironment,
        MAX_UPLOAD_BYTES: '104857600',
      }),
    ).toThrow('MAX_UPLOAD_BYTES');
    expect(() =>
      readStorageConfig({ ...configuredEnvironment, IMAGE_QUALITY: '10' }),
    ).toThrow('IMAGE_QUALITY');
  });

  it('requires an explicit boolean for path-style addressing', () => {
    expect(() =>
      readStorageConfig({
        ...configuredEnvironment,
        S3_FORCE_PATH_STYLE: 'sometimes',
      }),
    ).toThrow('S3_FORCE_PATH_STYLE');
  });

  it('surfaces a broken configuration at boot', () => {
    expect(() =>
      validateStorageEnvironment({
        ...configuredEnvironment,
        S3_SECRET_ACCESS_KEY: '',
      }),
    ).toThrow('S3_SECRET_ACCESS_KEY');
  });
});
