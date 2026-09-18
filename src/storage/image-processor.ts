import sharp from 'sharp';

/**
 * The only place that decodes user-supplied image data.
 *
 * Every upload is re-encoded to WebP rather than stored as received. That
 * normalises the format for clients, shrinks phone photos by an order of
 * magnitude, and drops all metadata (including EXIF GPS coordinates) because
 * sharp only copies metadata when explicitly asked to.
 */

export const PROCESSED_IMAGE_CONTENT_TYPE = 'image/webp';
export const PROCESSED_IMAGE_EXTENSION = 'webp';

// A decompression bomb can be small on the wire and enormous once decoded.
const MAX_INPUT_PIXELS = 50_000_000;

export interface ProcessedImage {
  buffer: Buffer;
  contentType: string;
  extension: string;
  width: number;
  height: number;
}

export interface ProcessImageOptions {
  /** Longest edge of the result, in pixels. */
  maxDimension: number;
  quality: number;
  /** Crop to a centred square. Used for avatars, which render in a circle. */
  square?: boolean;
}

export async function processImage(
  input: Buffer,
  { maxDimension, quality, square = false }: ProcessImageOptions,
): Promise<ProcessedImage> {
  const { data, info } = await sharp(input, {
    limitInputPixels: MAX_INPUT_PIXELS,
    // An animated source is flattened to its first frame on purpose: animated
    // WebP costs far more to encode and nothing in the app plays avatars.
    animated: false,
  })
    // Applies the EXIF orientation flag before the tag is discarded.
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: square ? 'cover' : 'inside',
      position: 'centre',
      withoutEnlargement: true,
    })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    contentType: PROCESSED_IMAGE_CONTENT_TYPE,
    extension: PROCESSED_IMAGE_EXTENSION,
    width: info.width,
    height: info.height,
  };
}
