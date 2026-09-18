/**
 * Object storage settings, read once from the environment.
 *
 * Storage is optional: when `S3_BUCKET` is absent the API still boots and the
 * upload endpoints answer `503 STORAGE_UNAVAILABLE`. That keeps unit tests and
 * a bare `nest start` usable without a MinIO container, while `docker compose`
 * always provides a fully configured bucket.
 */

export interface StorageConfig {
  /** Endpoint the API itself calls (inside Compose: http://minio:9000). */
  endpoint: string;
  /** Endpoint presigned URLs are signed for, i.e. what a client can reach. */
  publicEndpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** Key prefix for durable objects. Mirrors the bucket policy in minio-init.sh. */
  uploadPrefix: string;
  /** Key prefix covered by the "expire quickly" lifecycle rule. */
  tempPrefix: string;
  presignedUrlTtlSeconds: number;
  maxUploadBytes: number;
  avatarMaxDimension: number;
  exerciseImageMaxDimension: number;
  imageQuality: number;
}

// SigV4 refuses to sign a presigned URL valid for longer than seven days.
const MAX_PRESIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
const MIN_PRESIGNED_URL_TTL_SECONDS = 60;
const MIN_UPLOAD_BYTES = 1024;
/**
 * Hard ceiling for a single request body, independent of `MAX_UPLOAD_BYTES`.
 *
 * Multer buffers an upload in memory, so the interceptor must cap the request
 * before the configurable limit is even consulted. Read at class-definition
 * time, which is why it is a constant rather than an environment value.
 */
export const MAX_IMAGE_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_UPLOAD_BYTES = MAX_IMAGE_UPLOAD_BYTES;
const MIN_IMAGE_DIMENSION = 64;
const MAX_IMAGE_DIMENSION = 4096;
const MIN_IMAGE_QUALITY = 40;
const MAX_IMAGE_QUALITY = 100;

const DEFAULTS = {
  region: 'us-east-1',
  uploadPrefix: 'uploads',
  tempPrefix: 'tmp',
  presignedUrlTtlSeconds: 900,
  maxUploadBytes: 10 * 1024 * 1024,
  avatarMaxDimension: 512,
  exerciseImageMaxDimension: 1280,
  imageQuality: 82,
} as const;

const PLACEHOLDER_SECRETS = new Set([
  'change_me',
  'change_me_storage_secret',
  'minioadmin',
  '',
]);
// A key prefix becomes part of an object key and of the bucket policy ARN, so
// keep it to a shape that cannot escape the bucket or confuse a policy match.
const PREFIX_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isStorageConfigured(environment: NodeJS.ProcessEnv): boolean {
  return Boolean(environment.S3_BUCKET?.trim());
}

function readInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function readPrefix(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string {
  const value = environment[name]?.trim() || fallback;
  if (!PREFIX_PATTERN.test(value)) {
    throw new Error(
      `${name} must be lowercase letters, digits or hyphens, starting with a letter or digit.`,
    );
  }
  return value;
}

function readEndpoint(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback?: string,
): string {
  const value = environment[name]?.trim() || fallback;
  if (!value) throw new Error(`${name} is required when S3_BUCKET is set.`);

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must use http or https.`);
  }
  // A trailing slash would double up when the SDK appends the bucket path.
  return value.replace(/\/+$/, '');
}

function readSecret(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim() ?? '';
  if (!value) throw new Error(`${name} is required when S3_BUCKET is set.`);
  if (PLACEHOLDER_SECRETS.has(value)) {
    throw new Error(`${name} must not use a placeholder or root credential.`);
  }
  return value;
}

function readBoolean(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
): boolean {
  const raw = environment[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function isValidBucketName(bucket: string): boolean {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return false;
  if (bucket.includes('..') || bucket.includes('.-') || bucket.includes('-.')) {
    return false;
  }
  return !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bucket);
}

/**
 * Builds the storage configuration, or throws a descriptive error.
 * Only call this when {@link isStorageConfigured} returns true.
 */
export function readStorageConfig(
  environment: NodeJS.ProcessEnv,
): StorageConfig {
  const bucket = environment.S3_BUCKET?.trim() ?? '';
  // Bucket naming rules are stricter than a generic slug: no underscores, no
  // uppercase, 3-63 characters, and never something that parses as an IP.
  if (!isValidBucketName(bucket)) {
    throw new Error(
      'S3_BUCKET must be 3-63 lowercase characters (letters, digits, dots or hyphens).',
    );
  }

  const endpoint = readEndpoint(environment, 'S3_ENDPOINT');
  const publicEndpoint = readEndpoint(
    environment,
    'S3_PUBLIC_ENDPOINT',
    endpoint,
  );
  const uploadPrefix = readPrefix(
    environment,
    'S3_UPLOAD_PREFIX',
    DEFAULTS.uploadPrefix,
  );
  const tempPrefix = readPrefix(
    environment,
    'S3_TEMP_PREFIX',
    DEFAULTS.tempPrefix,
  );
  if (uploadPrefix === tempPrefix) {
    throw new Error('S3_UPLOAD_PREFIX and S3_TEMP_PREFIX must differ.');
  }

  const accessKeyId = readSecret(environment, 'S3_ACCESS_KEY_ID');
  if (
    environment.MINIO_ROOT_USER?.trim() &&
    accessKeyId === environment.MINIO_ROOT_USER.trim()
  ) {
    throw new Error('S3_ACCESS_KEY_ID must not use the MinIO root credential.');
  }

  return {
    endpoint,
    publicEndpoint,
    region: environment.S3_REGION?.trim() || DEFAULTS.region,
    bucket,
    accessKeyId,
    secretAccessKey: readSecret(environment, 'S3_SECRET_ACCESS_KEY'),
    // MinIO has no wildcard DNS, so path-style addressing is the default here.
    forcePathStyle: readBoolean(environment, 'S3_FORCE_PATH_STYLE', true),
    uploadPrefix,
    tempPrefix,
    presignedUrlTtlSeconds: readInteger(
      environment,
      'S3_PRESIGNED_URL_TTL_SECONDS',
      DEFAULTS.presignedUrlTtlSeconds,
      MIN_PRESIGNED_URL_TTL_SECONDS,
      MAX_PRESIGNED_URL_TTL_SECONDS,
    ),
    maxUploadBytes: readInteger(
      environment,
      'MAX_UPLOAD_BYTES',
      DEFAULTS.maxUploadBytes,
      MIN_UPLOAD_BYTES,
      MAX_UPLOAD_BYTES,
    ),
    avatarMaxDimension: readInteger(
      environment,
      'AVATAR_MAX_DIMENSION',
      DEFAULTS.avatarMaxDimension,
      MIN_IMAGE_DIMENSION,
      MAX_IMAGE_DIMENSION,
    ),
    exerciseImageMaxDimension: readInteger(
      environment,
      'EXERCISE_IMAGE_MAX_DIMENSION',
      DEFAULTS.exerciseImageMaxDimension,
      MIN_IMAGE_DIMENSION,
      MAX_IMAGE_DIMENSION,
    ),
    imageQuality: readInteger(
      environment,
      'IMAGE_QUALITY',
      DEFAULTS.imageQuality,
      MIN_IMAGE_QUALITY,
      MAX_IMAGE_QUALITY,
    ),
  };
}

/**
 * Fails fast at boot on a half-written storage configuration instead of
 * surfacing it as a 500 on the first avatar upload.
 */
export function validateStorageEnvironment(
  environment: NodeJS.ProcessEnv,
): void {
  if (!isStorageConfigured(environment)) return;
  readStorageConfig(environment);
}
