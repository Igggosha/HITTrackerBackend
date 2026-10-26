import { readFile } from 'node:fs/promises';
import { validateCatalog } from './catalog-validate';

it('validates the normalized catalog shape and complete source coverage', async () => {
  const source = JSON.parse(await readFile('data/catalog/figma-source.json', 'utf8'));
  const catalog = JSON.parse(await readFile('data/catalog/catalog.normalized.json', 'utf8'));
  expect(() => validateCatalog(source, catalog)).not.toThrow();
  expect(Buffer.from(JSON.stringify(catalog), 'utf8').toString('utf8')).toContain('Сідниці');
});
