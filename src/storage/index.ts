// EN: Defines the public storage-module surface used by feature modules while keeping S3 implementation details internal.
// UK: Визначає публічний інтерфейс модуля сховища для функціональних модулів, залишаючи деталі реалізації S3 внутрішніми.

export { StorageModule } from './storage.module';
export { StorageService } from './storage.service';
export type { StoredImage } from './storage.service';
export { STORAGE_SCOPES } from './object-key';
export type { StorageScope } from './object-key';
export type { UploadedFile } from './upload-validation';
export { MAX_IMAGE_UPLOAD_BYTES } from './storage.config';
