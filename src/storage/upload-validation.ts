/**
 * Everything about an upload that can be decided without decoding the image.
 *
 * The declared content type comes from the client and is treated as a hint
 * only; the first bytes of the payload decide what the file really is.
 */

export const SUPPORTED_IMAGE_FORMATS = ['jpeg', 'png', 'webp', 'gif'] as const;
export type SupportedImageFormat = (typeof SUPPORTED_IMAGE_FORMATS)[number];

/** Minimal shape of a multer file; avoids depending on the multer typings. */
export interface UploadedFile {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer?: Buffer;
}

export type UploadRejection =
  'FILE_REQUIRED' | 'FILE_TOO_LARGE' | 'UNSUPPORTED_IMAGE_TYPE';

export interface UploadRejected {
  ok: false;
  code: UploadRejection;
  message: string;
}

export interface UploadAccepted {
  ok: true;
  buffer: Buffer;
  format: SupportedImageFormat;
}

export type UploadValidation = UploadAccepted | UploadRejected;

/**
 * Reads the container signature rather than trusting `Content-Type`, so a
 * renamed `.exe` or an SVG carrying script never reaches the image decoder.
 */
export function detectImageFormat(buffer: Buffer): SupportedImageFormat | null {
  if (buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  const gifHeader = buffer.subarray(0, 6).toString('ascii');
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return 'gif';
  }

  return null;
}

export function validateImageUpload(
  file: UploadedFile | undefined,
  maxUploadBytes: number,
): UploadValidation {
  if (!file?.buffer || file.buffer.length === 0) {
    return {
      ok: false,
      code: 'FILE_REQUIRED',
      message: 'An image file is required',
    };
  }

  // `size` is what multer counted; the buffer is what we are about to store.
  const byteLength = Math.max(file.size ?? 0, file.buffer.length);
  if (byteLength > maxUploadBytes) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `Image must be ${Math.floor(maxUploadBytes / 1024)} KB or smaller`,
    };
  }

  const format = detectImageFormat(file.buffer);
  if (!format) {
    return {
      ok: false,
      code: 'UNSUPPORTED_IMAGE_TYPE',
      message: 'Image must be a JPEG, PNG, WebP or GIF file',
    };
  }

  return { ok: true, buffer: file.buffer, format };
}
