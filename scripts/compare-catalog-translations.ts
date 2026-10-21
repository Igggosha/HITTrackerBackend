import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  sampleText,
  translateSample,
  translationChecks,
  validateBenchmark,
  type TranslationConfig,
  type TranslationSample,
} from './compare-catalog-translations.logic';

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--run')) {
    throw new Error(
      'Usage: npx tsx scripts/compare-catalog-translations.ts [--run]',
    );
  }
  const dataset = JSON.parse(
    await readFile(resolve('data/catalog/translation-benchmark.json'), 'utf8'),
  ) as { samples: TranslationSample[] };
  validateBenchmark(dataset.samples);
  const source = JSON.parse(
    await readFile(resolve('data/catalog/figma-source.json'), 'utf8'),
  ) as { exerciseRows: { values: string[] }[] };
  const names = new Set(source.exerciseRows.map((row) => row.values[0]));
  if (dataset.samples.some((sample) => !names.has(sample.sourceName))) {
    throw new Error(
      'Benchmark contains an exercise absent from the Figma source.',
    );
  }
  const run = args.includes('--run');
  const results: Record<string, unknown>[] = [];
  for (const locale of ['uk', 'pl'] as const) {
    for (const provider of ['deepl', 'google'] as const) {
      const key =
        provider === 'deepl'
          ? process.env.DEEPL_API_KEY
          : process.env.GOOGLE_TRANSLATE_ACCESS_TOKEN;
      const glossary =
        process.env[
          `${provider.toUpperCase()}_GLOSSARY_${locale.toUpperCase()}`
        ];
      const config: TranslationConfig = {
        provider,
        key: key || '',
        project: process.env.GOOGLE_TRANSLATE_PROJECT,
        location: process.env.GOOGLE_TRANSLATE_LOCATION,
        free: process.env.DEEPL_API_PLAN !== 'pro',
        glossary,
      };
      for (const sample of dataset.samples) {
        const row: Record<string, unknown> = {
          sampleId: sample.id,
          provider,
          locale,
          glossaryConfigured: !!glossary,
          source: sampleText(sample),
          terminologyHints: sample.reviewHints[locale],
          status: !run ? 'NOT_RUN' : !key ? 'MISSING_CREDENTIALS' : 'PENDING',
          review: null,
        };
        if (run && key) {
          try {
            const translated = await translateSample(config, sample, locale);
            Object.assign(row, {
              status: 'REQUIRES_REVIEW',
              translated,
              checks: translationChecks(sampleText(sample), translated),
            });
          } catch (error) {
            Object.assign(row, {
              status: 'FAILED',
              error:
                error instanceof Error &&
                /^(deepl|google): (HTTP \d+|missing translated text)$/.test(
                  error.message,
                )
                  ? error.message
                  : 'Provider request failed; inspect configuration and connectivity.',
            });
          }
        }
        results.push(row);
      }
    }
  }
  await mkdir(resolve('.tmp'), { recursive: true });
  await writeFile(
    resolve('.tmp/catalog-translation-comparison.json'),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        winner: null,
        mode: run ? 'API_REQUESTS' : 'OFFLINE_PREPARATION',
        reviewCriteria: [
          'terminology',
          'negations',
          'numbers and units',
          'omissions',
          'added advice',
          'natural phrasing',
        ],
        note: 'No automatic quality score. Number checks do not establish semantic correctness. DeepL uses context; Google uses full exercise text. Glossary use is recorded per result.',
        results,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(
    `Prepared ${results.length} comparison rows. Winner: NOT SELECTED.`,
  );
  console.log('Report: .tmp/catalog-translation-comparison.json');
  if (run && results.some((row) => row.status !== 'REQUIRES_REVIEW'))
    process.exitCode = 1;
}

void main().catch(() => {
  console.error(
    'Comparison failed. Check input files, arguments and configuration. Credentials are never printed.',
  );
  process.exitCode = 1;
});
