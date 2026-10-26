import {
  parseMediaUploadArgs,
  uploadableEntries,
} from './catalog-media-upload.logic';

describe('catalog media upload safety', () => {
  it('defaults to preview and rejects unknown flags', () => {
    expect(parseMediaUploadArgs([])).toEqual({ apply: false });
    expect(parseMediaUploadArgs(['--apply'])).toEqual({ apply: true });
    expect(() => parseMediaUploadArgs(['--force'])).toThrow('Unknown argument');
  });

  it('uploads only unresolved reviewed candidates', () => {
    const entry = (
      status: string,
      source: string | null,
      objectKey: string | null,
    ) => ({
      catalogKey: status,
      image: { status, source, objectKey },
    });
    expect(
      uploadableEntries([
        entry('candidate', 'https://example.test/image.png', null),
        entry(
          'ready',
          'https://example.test/image.png',
          'uploads/exercises/1/a.webp',
        ),
        entry('missing', null, null),
      ]),
    ).toHaveLength(1);
  });
});
