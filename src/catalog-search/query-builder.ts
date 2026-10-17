// EN: Builds a bounded Elasticsearch bool query whose boosts prioritize exact and phrase matches before prefix, n-gram, and fuzzy recall.
// UK: Формує обмежений bool-запит Elasticsearch, де коефіцієнти ваги надають перевагу точним і фразовим збігам перед префіксним, n-gram і нечітким пошуком.

import type { estypes } from '@elastic/elasticsearch';
import type { CatalogSection } from './catalog-search.constants';

type SearchOptions = {
  q: string;
  section: CatalogSection;
  userId: number;
  scope: 'all' | 'official' | 'personal' | 'saved';
  muscle?: number;
  allowedIds?: number[];
};

const nameFields = ['name^8', 'aliases^7'];

export function fuzzyEdits(token: string): 0 | 1 | 2 {
  const length = [...token].length;
  if (length < 4) return 0;
  return length >= 8 ? 2 : 1;
}

function fuzzyClause(query: string): estypes.QueryDslQueryContainer | null {
  const tokens = query.split(/\s+/u).filter(Boolean);
  // EN: Short tokens never use fuzziness, limiting noisy expansions and keeping Cyrillic one-to-three-character searches predictable.
  // UK: Короткі токени не використовують нечіткий пошук, що обмежує зайві розширення та робить кириличні запити з одного-трьох символів передбачуваними.
  if (!tokens.some((token) => fuzzyEdits(token))) return null;
  return {
    bool: {
      must: tokens.map((token) => {
        const fuzziness = fuzzyEdits(token);
        return {
          multi_match: {
            query: token,
            fields: nameFields,
            type: 'best_fields',
            operator: 'and',
            ...(fuzziness
              ? {
                  fuzziness,
                  prefix_length: 1,
                  max_expansions: 25,
                  fuzzy_transpositions: true,
                }
              : {}),
          },
        };
      }),
      boost: 2,
    },
  };
}

export function buildCatalogQuery({
  q,
  section,
  userId,
  scope,
  muscle,
  allowedIds,
}: SearchOptions): estypes.QueryDslQueryContainer {
  const query = q.trim();
  // EN: Visibility is a mandatory filter, never a scoring clause, so relevance cannot promote a document the user may not access.
  // UK: Видимість є обов'язковим фільтром, а не умовою ранжування, тому релевантність не може підняти недоступний користувачу документ.
  const filter: estypes.QueryDslQueryContainer[] = [
    { term: { deleted: false } },
  ];
  if (section === 'programs') {
    filter.push({
      bool: {
        should: [
          {
            bool: {
              filter: [
                { term: { isPersonal: false } },
                { term: { isActive: true } },
              ],
            },
          },
          {
            bool: {
              filter: [
                { term: { isPersonal: true } },
                { term: { ownerId: userId } },
              ],
            },
          },
        ],
        minimum_should_match: 1,
      },
    });
    if (scope === 'official') filter.push({ term: { isPersonal: false } });
    if (scope === 'personal') {
      filter.push(
        { term: { isPersonal: true } },
        { term: { ownerId: userId } },
      );
    }
  }
  if (muscle) filter.push({ term: { muscleIds: muscle } });
  if (allowedIds) filter.push({ terms: { id: allowedIds } });

  if (!query) return { bool: { filter } };
  const phraseFields = [
    'name^8',
    'aliases^7',
    ...(section === 'programs'
      ? ['exerciseNames^3', 'muscleNames^2', 'description']
      : ['muscleNames^3', 'description']),
  ];
  if ([...query].length === 1) {
    return {
      bool: {
        filter,
        must: [
          {
            multi_match: { query, fields: ['name.ngram^8', 'aliases.ngram^7'] },
          },
        ],
      },
    };
  }
  // EN: Boosts intentionally descend from exact keyword and phrase matches to prefix, n-gram, all-token, and finally fuzzy recall.
  // UK: Коефіцієнти ваги навмисно зменшуються від точного й фразового збігу до префіксного, n-gram, збігу всіх токенів і лише потім нечіткого пошуку.
  const should: estypes.QueryDslQueryContainer[] = [
    { term: { 'name.keyword': { value: query.toLowerCase(), boost: 30 } } },
    { term: { 'aliases.keyword': { value: query.toLowerCase(), boost: 25 } } },
    { multi_match: { query, fields: phraseFields, type: 'phrase', boost: 15 } },
    {
      multi_match: {
        query,
        fields: nameFields,
        type: 'phrase_prefix',
        boost: 12,
        max_expansions: 25,
      },
    },
    {
      multi_match: {
        query,
        fields: ['name.ngram^7', 'aliases.ngram^6'],
        operator: 'and',
        boost: 8,
      },
    },
    { multi_match: { query, fields: phraseFields, operator: 'and', boost: 4 } },
  ];
  const fuzzy = fuzzyClause(query);
  if (fuzzy) should.push(fuzzy);
  return { bool: { filter, should, minimum_should_match: 1 } };
}

export function searchSort(
  sort: 'relevance' | 'popular' | 'newest' | 'alphabetical',
  section: CatalogSection,
): estypes.Sort {
  switch (sort) {
    case 'popular':
      return [{ likesCount: 'desc' }, { id: 'asc' }];
    case 'newest':
      return section === 'exercises'
        ? [{ id: 'desc' }]
        : [{ createdAt: 'desc' }, { id: 'asc' }];
    case 'alphabetical':
      return [{ 'name.keyword': 'asc' }, { id: 'asc' }];
    default:
      return [{ _score: { order: 'desc' } }, { id: 'asc' }];
  }
}
