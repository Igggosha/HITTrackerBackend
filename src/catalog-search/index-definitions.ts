import type { estypes } from '@elastic/elasticsearch';

const nameField = {
  type: 'text' as const,
  analyzer: 'catalog_text',
  fields: {
    keyword: { type: 'keyword' as const, normalizer: 'catalog_keyword' },
    ngram: {
      type: 'text' as const,
      analyzer: 'catalog_name_ngram',
      search_analyzer: 'catalog_text',
    },
  },
};

export const catalogIndexSettings = {
  number_of_shards: 1,
  number_of_replicas: 0,
  max_ngram_diff: 14,
  analysis: {
    char_filter: {
      yo_fold: { type: 'mapping', mappings: ['ё => е', 'Ё => Е'] },
    },
    tokenizer: {
      catalog_name_grams: {
        type: 'ngram',
        min_gram: 1,
        max_gram: 15,
        token_chars: ['letter', 'digit'],
      },
    },
    analyzer: {
      catalog_text: {
        type: 'custom',
        char_filter: ['yo_fold'],
        tokenizer: 'standard',
        filter: ['lowercase'],
      },
      catalog_name_ngram: {
        type: 'custom',
        char_filter: ['yo_fold'],
        tokenizer: 'catalog_name_grams',
        filter: ['lowercase'],
      },
    },
    normalizer: {
      catalog_keyword: { type: 'custom', filter: ['lowercase'] },
    },
  },
} satisfies estypes.IndicesIndexSettings;

const commonProperties = {
  id: { type: 'integer' as const },
  name: nameField,
  aliases: nameField,
  description: { type: 'text' as const, analyzer: 'catalog_text' },
  likesCount: { type: 'integer' as const },
  createdAt: { type: 'date' as const },
  hasImage: { type: 'boolean' as const },
  deleted: { type: 'boolean' as const },
  lastEventAt: { type: 'date' as const },
  lastEventId: { type: 'keyword' as const },
};

export const programIndexDefinition = {
  settings: catalogIndexSettings,
  mappings: {
    dynamic: 'strict' as const,
    properties: {
      ...commonProperties,
      isPersonal: { type: 'boolean' as const },
      isActive: { type: 'boolean' as const },
      ownerId: { type: 'integer' as const },
      exerciseNames: { ...nameField },
      muscleIds: { type: 'integer' as const },
      muscleNames: { ...nameField },
    },
  },
};

export const exerciseIndexDefinition = {
  settings: catalogIndexSettings,
  mappings: {
    dynamic: 'strict' as const,
    properties: {
      ...commonProperties,
      muscleIds: { type: 'integer' as const },
      muscleNames: { ...nameField },
    },
  },
};
