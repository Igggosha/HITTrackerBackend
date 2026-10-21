export type TranslationSample = {
  id: string;
  sourceName: string;
  name: string;
  instructions: string;
  reviewHints: Record<string, string[]>;
};

export type TranslationConfig = {
  provider: 'deepl' | 'google';
  key: string;
  project?: string;
  location?: string;
  free?: boolean;
  glossary?: string;
};

export const sampleText = (sample: TranslationSample) =>
  `${sample.name}\n${sample.instructions}`;

export function translationChecks(source: string, translated: string) {
  const numbers = (value: string) =>
    (value.match(/\d+(?:[.,]\d+)?/g) || [])
      .map((number) => number.replace(',', '.'))
      .sort();
  return {
    nonEmpty: translated.trim().length > 0,
    numbersPreserved:
      JSON.stringify(numbers(source)) === JSON.stringify(numbers(translated)),
    humanReviewRequired: true,
  };
}

export function validateBenchmark(samples: TranslationSample[]) {
  if (samples.length !== 20 || new Set(samples.map((s) => s.id)).size !== 20) {
    throw new Error(
      'Benchmark must contain exactly 20 unique exercise samples.',
    );
  }
  for (const sample of samples) {
    if (
      !sample.id ||
      !sample.sourceName ||
      !sample.name ||
      !sample.instructions
    ) {
      throw new Error('Benchmark sample is incomplete.');
    }
  }
}

export async function translateSample(
  config: TranslationConfig,
  sample: TranslationSample,
  locale: 'uk' | 'pl',
  request: typeof fetch = fetch,
): Promise<string> {
  const text = sampleText(sample);
  let url: string;
  let headers: Record<string, string>;
  let body: Record<string, unknown>;
  if (config.provider === 'deepl') {
    url = `https://${config.free ? 'api-free' : 'api'}.deepl.com/v2/translate`;
    headers = { Authorization: `DeepL-Auth-Key ${config.key}` };
    body = {
      text: [text],
      source_lang: 'EN',
      target_lang: locale.toUpperCase(),
      context:
        'Fitness exercise catalog. The first line is the exercise name, followed by technique instructions. ' +
        'Use established strength-training terminology. Preserve negation, numbers, units and meaning. ' +
        `English exercise: ${sample.name}. ${sample.instructions}`,
      ...(config.glossary ? { glossary_id: config.glossary } : {}),
    };
  } else {
    if (!config.project || !/^[a-zA-Z0-9-]+$/.test(config.project)) {
      throw new Error('Google Translation requires a valid project ID.');
    }
    const location = config.location || 'global';
    if (!/^[a-z0-9-]+$/.test(location)) {
      throw new Error('Invalid Google Translation location.');
    }
    const parent = `projects/${config.project}/locations/${location}`;
    if (
      config.glossary &&
      !config.glossary.startsWith(`${parent}/glossaries/`)
    ) {
      throw new Error(
        'Google glossary must belong to the configured project and location.',
      );
    }
    url = `https://translation.googleapis.com/v3/${parent}:translateText`;
    headers = { Authorization: `Bearer ${config.key}` };
    body = {
      contents: [text],
      mimeType: 'text/plain',
      sourceLanguageCode: 'en',
      targetLanguageCode: locale,
      ...(config.glossary
        ? { glossaryConfig: { glossary: config.glossary } }
        : {}),
    };
  }
  const response = await request(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  // Provider bodies may echo submitted data; errors expose only provider and status.
  // Відповіді провайдера можуть містити вхідні дані; помилки показують лише провайдера та статус.
  if (!response.ok) {
    throw new Error(`${config.provider}: HTTP ${response.status}`);
  }
  const result = (await response.json()) as {
    translations?: { text?: string; translatedText?: string }[];
    glossaryTranslations?: { translatedText?: string }[];
  };
  const translated =
    config.provider === 'deepl'
      ? result.translations?.[0]?.text
      : config.glossary
        ? result.glossaryTranslations?.[0]?.translatedText
        : result.translations?.[0]?.translatedText;
  if (typeof translated !== 'string' || !translated.trim()) {
    throw new Error(`${config.provider}: missing translated text`);
  }
  return translated;
}
