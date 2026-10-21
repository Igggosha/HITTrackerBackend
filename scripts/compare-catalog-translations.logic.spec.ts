import {
  translateSample,
  translationChecks,
  type TranslationSample,
} from './compare-catalog-translations.logic';

const sample: TranslationSample = {
  id: 'plank',
  sourceName: 'Планка',
  name: 'Plank',
  instructions: 'Hold for 30 seconds. Do not hold your breath.',
  reviewHints: {},
};

it('flags lost numbers without claiming that preserved numbers prove quality', () => {
  expect(translationChecks(sample.instructions, 'Тримайте 30 секунд.')).toEqual(
    {
      nonEmpty: true,
      numbersPreserved: true,
      humanReviewRequired: true,
    },
  );
  expect(
    translationChecks(sample.instructions, 'Тримайте 20 секунд.')
      .numbersPreserved,
  ).toBe(false);
  expect(translationChecks(sample.instructions, '').nonEmpty).toBe(false);
});

it('sends DeepL full exercise context and the selected glossary', async () => {
  const request = jest.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        translations: [{ text: 'Планка\nТримайте 30 секунд.' }],
      }),
    ),
  );
  await expect(
    translateSample(
      { provider: 'deepl', key: 'test', free: true, glossary: 'uk-glossary' },
      sample,
      'uk',
      request,
    ),
  ).resolves.toContain('Планка');
  const [url, options] = request.mock.calls[0];
  expect(url).toBe('https://api-free.deepl.com/v2/translate');
  expect(JSON.parse(options.body)).toMatchObject({
    source_lang: 'EN',
    target_lang: 'UK',
    glossary_id: 'uk-glossary',
    text: ['Plank\nHold for 30 seconds. Do not hold your breath.'],
  });
});

it('reads Google glossary results rather than discarding the glossary', async () => {
  const request = jest.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        translations: [{ translatedText: 'baseline' }],
        glossaryTranslations: [{ translatedText: 'glossary version' }],
      }),
    ),
  );
  await expect(
    translateSample(
      {
        provider: 'google',
        key: 'test',
        project: 'test-project',
        location: 'us-central1',
        glossary: 'projects/test-project/locations/us-central1/glossaries/uk',
      },
      sample,
      'uk',
      request,
    ),
  ).resolves.toBe('glossary version');
});

it('does not leak a provider error body or credentials', async () => {
  const request = jest
    .fn()
    .mockResolvedValue(new Response('secret echoed payload', { status: 403 }));
  await expect(
    translateSample(
      { provider: 'deepl', key: 'secret' },
      sample,
      'pl',
      request,
    ),
  ).rejects.toThrow('deepl: HTTP 403');
});

it('rejects missing translations and a glossary outside the configured project', async () => {
  const request = jest.fn().mockResolvedValue(new Response('{}'));
  await expect(
    translateSample(
      { provider: 'google', key: 'test', project: 'test-project' },
      sample,
      'uk',
      request,
    ),
  ).rejects.toThrow('missing translated text');
  await expect(
    translateSample(
      {
        provider: 'google',
        key: 'test',
        project: 'test-project',
        glossary: 'projects/other/locations/global/glossaries/uk',
      },
      sample,
      'uk',
      request,
    ),
  ).rejects.toThrow('configured project');
});
