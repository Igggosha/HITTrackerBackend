import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { processImage } from './image-processor';
import type { ProcessedImage } from './image-processor';
import { buildObjectKey, isManagedObjectKey } from './object-key';
import type { StorageScope } from './object-key';
import { STORAGE_CONFIG } from './storage.tokens';
import type { StorageConfig } from './storage.config';
import { validateImageUpload } from './upload-validation';
import type { UploadedFile } from './upload-validation';

export interface StoredImage {
  key: string;
  width: number;
  height: number;
}

export interface UploadImageOptions {
  scope: StorageScope;
  ownerId: number;
  file: UploadedFile | undefined;
  maxDimension: number;
  square?: boolean;
}

/**
 * The single seam between the API and the object store.
 *
 * The bucket is private. Clients never address MinIO by object key; they follow
 * a short-lived presigned URL that this service mints from the key kept in the
 * database. Uploads are signed against the internal endpoint, while reads are
 * signed against the public one, because a SigV4 signature is bound to the host
 * the client will actually call.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly readClient: S3Client | null;

  constructor(
    @Inject(STORAGE_CONFIG) private readonly config: StorageConfig | null,
  ) {
    if (!config) {
      this.client = null;
      this.readClient = null;
      this.logger.warn(
        'S3_BUCKET is not set; media upload endpoints will answer 503.',
      );
      return;
    }

    const credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials,
    });
    this.readClient =
      config.publicEndpoint === config.endpoint
        ? this.client
        : new S3Client({
            endpoint: config.publicEndpoint,
            region: config.region,
            forcePathStyle: config.forcePathStyle,
            credentials,
          });
  }

  get isEnabled(): boolean {
    return this.config !== null;
  }

  /** Image limits the controllers and services size their uploads against. */
  get limits(): Pick<
    StorageConfig,
    | 'maxUploadBytes'
    | 'avatarMaxDimension'
    | 'exerciseImageMaxDimension'
    | 'imageQuality'
  > {
    const config = this.requireConfig();
    return {
      maxUploadBytes: config.maxUploadBytes,
      avatarMaxDimension: config.avatarMaxDimension,
      exerciseImageMaxDimension: config.exerciseImageMaxDimension,
      imageQuality: config.imageQuality,
    };
  }

  /**
   * Validates, re-encodes and stores an image, returning the key to persist.
   */
  async uploadImage({
    scope,
    ownerId,
    file,
    maxDimension,
    square,
  }: UploadImageOptions): Promise<StoredImage> {
    const config = this.requireConfig();
    const validation = validateImageUpload(file, config.maxUploadBytes);
    if (!validation.ok) {
      throw new BadRequestException({
        message: validation.message,
        code: validation.code,
      });
    }

    let processed: ProcessedImage;
    try {
      processed = await processImage(validation.buffer, {
        maxDimension,
        quality: config.imageQuality,
        square,
      });
    } catch {
      // The bytes passed the signature check but the decoder refused them.
      // Nothing here is safe to echo back to the client.
      throw new BadRequestException({
        message: 'Image could not be processed',
        code: 'UNSUPPORTED_IMAGE_TYPE',
      });
    }

    const key = buildObjectKey({
      prefix: config.uploadPrefix,
      scope,
      ownerId,
      extension: processed.extension,
    });

    await this.client!.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: processed.buffer,
        ContentType: processed.contentType,
        // Objects are immutable: a replacement always gets a fresh key.
        CacheControl: 'private, max-age=31536000, immutable',
      }),
    );

    return {
      key,
      width: processed.width,
      height: processed.height,
    };
  }

  /**
   * Mints a presigned GET URL for a stored key. Returns null for a missing key
   * so callers can hand it straight to a nullable response field.
   */
  async getUrl(key: string | null | undefined): Promise<string | null> {
    if (!key || !this.config || !this.readClient) return null;
    if (!this.isOwnKey(key)) {
      this.logger.warn(
        'Refusing to sign an object key outside the managed prefixes.',
      );
      return null;
    }

    return await getSignedUrl(
      this.readClient,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: this.config.presignedUrlTtlSeconds },
    );
  }

  /** Signs many keys at once; nothing here talks to the network. */
  async getUrls(
    keys: readonly (string | null | undefined)[],
  ): Promise<(string | null)[]> {
    return Promise.all(keys.map((key) => this.getUrl(key)));
  }

  /**
   * Best-effort delete of a replaced or removed object.
   *
   * A failure here must not fail the request that already updated the database:
   * a leftover object is a cleanup problem, a failed profile update is a bug.
   */
  async remove(key: string | null | undefined): Promise<void> {
    if (!key || !this.config || !this.client) return;
    if (!this.isOwnKey(key)) {
      this.logger.warn(
        'Refusing to delete an object key outside the managed prefixes.',
      );
      return;
    }

    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
    } catch (error) {
      this.logger.warn(
        `Could not delete a replaced object: ${(error as Error).message}`,
      );
    }
  }

  private isOwnKey(key: string): boolean {
    if (!this.config) return false;
    return isManagedObjectKey(key, [
      this.config.uploadPrefix,
      this.config.tempPrefix,
    ]);
  }

  private requireConfig(): StorageConfig {
    if (!this.config) {
      throw new ServiceUnavailableException({
        message: 'File storage is not configured',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    return this.config;
  }
}
