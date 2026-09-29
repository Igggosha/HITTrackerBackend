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
