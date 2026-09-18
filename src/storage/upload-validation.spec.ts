import {
  detectImageFormat,
  validateImageUpload,
  type UploadedFile,
} from './upload-validation';

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG_HEADER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

function webpHeader(): Buffer {
  const buffer = Buffer.alloc(16);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(8, 4);
  buffer.write('WEBP', 8, 'ascii');
  return buffer;
}

function upload(buffer: Buffer, overrides: Partial<UploadedFile> = {}) {
  return { buffer, size: buffer.length, mimetype: 'image/png', ...overrides };
}

describe('upload validation', () => {
  it('identifies the formats the API accepts', () => {
    expect(detectImageFormat(PNG_HEADER)).toBe('png');
    expect(detectImageFormat(JPEG_HEADER)).toBe('jpeg');
    expect(detectImageFormat(webpHeader())).toBe('webp');
    expect(detectImageFormat(Buffer.from('GIF89a' + 'x'.repeat(10)))).toBe(
      'gif',
    );
  });

  it('ignores a declared content type that the bytes contradict', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    expect(detectImageFormat(svg)).toBeNull();
    expect(
      validateImageUpload(upload(svg, { mimetype: 'image/png' }), 1024 * 1024),
    ).toMatchObject({ ok: false, code: 'UNSUPPORTED_IMAGE_TYPE' });
  });

  it('rejects a payload shorter than any container header', () => {
    expect(detectImageFormat(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it('requires a file to be present', () => {
    expect(validateImageUpload(undefined, 1024 * 1024)).toMatchObject({
      ok: false,
      code: 'FILE_REQUIRED',
    });
    expect(
      validateImageUpload({ buffer: Buffer.alloc(0) }, 1024 * 1024),
    ).toMatchObject({ ok: false, code: 'FILE_REQUIRED' });
  });

  it('enforces the size limit against the larger of reported and real size', () => {
    const payload = Buffer.concat([PNG_HEADER, Buffer.alloc(4096)]);

    expect(validateImageUpload(upload(payload), 1024)).toMatchObject({
      ok: false,
      code: 'FILE_TOO_LARGE',
    });
    // A client under-reporting `size` must not slip past the limit.
    expect(
      validateImageUpload(upload(payload, { size: 1 }), 1024),
    ).toMatchObject({ ok: false, code: 'FILE_TOO_LARGE' });
    expect(validateImageUpload(upload(payload), 1024 * 1024)).toMatchObject({
      ok: true,
      format: 'png',
    });
  });
});
