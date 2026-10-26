import { readFile, writeFile } from 'node:fs/promises';

type Entry = {
  catalogKey: string;
  image: { status: string };
  videos: { en: { status: string }; uk: { status: string } };
};

async function main() {
  const registry = JSON.parse(
    await readFile('data/catalog/media-registry.json', 'utf8'),
  ) as { entries: Entry[] };
  const missing = (select: (entry: Entry) => boolean) =>
    registry.entries.filter(select).map((entry) => `- \`${entry.catalogKey}\``);
  const sections = [
    '# Missing catalog media',
    '',
    'Generated from `media-registry.json`. A missing item uses the existing application fallback and is not replaced with an unrelated asset.',
    '',
    '## Images',
    '',
    ...missing((entry) => entry.image.status !== 'ready' && entry.image.status !== 'candidate'),
    '',
    '## English videos',
    '',
    ...missing((entry) => entry.videos.en.status !== 'ready'),
    '',
    '## Ukrainian videos',
    '',
    ...missing((entry) => entry.videos.uk.status !== 'ready'),
    '',
  ];
  await writeFile('data/catalog/media-missing.md', sections.join('\n'), 'utf8');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
