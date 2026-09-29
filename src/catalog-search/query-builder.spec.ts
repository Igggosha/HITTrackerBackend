import { buildCatalogQuery, fuzzyEdits } from './query-builder';

describe('catalog query builder', () => {
  const query = (q: string) =>
    buildCatalogQuery({ q, section: 'programs', userId: 7, scope: 'all' });

  it('uses only bounded name n-grams for one character and no fuzzy below four', () => {
    expect(JSON.stringify(query('ж'))).toContain('name.ngram');
    expect(JSON.stringify(query('ж'))).not.toContain('fuzziness');
    expect(JSON.stringify(query('жим'))).not.toContain('fuzziness');
  });

  it('allows one typo from four characters and at most two for long words', () => {
    expect(fuzzyEdits('лежя')).toBe(1);
    expect(fuzzyEdits('тренеровка')).toBe(2);
    expect(JSON.stringify(query('жим лежя'))).toContain('fuzzy_transpositions');
    expect(JSON.stringify(query('тренеровка'))).toContain('"fuzziness":2');
  });

  it('keeps descriptions out of fuzzy clauses and visibility inside every query', () => {
    const built = query('тренеровка') as {
      bool: { should: unknown[]; filter: unknown[] };
    };
    const fuzzy = JSON.stringify(built.bool.should.at(-1));
    expect(fuzzy).not.toContain('description');
    expect(JSON.stringify(built.bool.filter)).toContain('ownerId');
  });
});
