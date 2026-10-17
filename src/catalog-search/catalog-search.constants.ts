// EN: Centralizes stable Elasticsearch aliases, index prefixes, and the indexed catalog document shape shared by producers and readers.
// UK: Централізує стабільні псевдоніми Elasticsearch, префікси індексів і форму документа каталогу, спільну для запису та читання.

export const PROGRAMS_READ_ALIAS = 'hit-programs-read';
export const PROGRAMS_WRITE_ALIAS = 'hit-programs-write';
export const EXERCISES_READ_ALIAS = 'hit-exercises-read';
export const EXERCISES_WRITE_ALIAS = 'hit-exercises-write';

export type CatalogSection = 'programs' | 'exercises';

export function aliasesFor(section: CatalogSection) {
  return section === 'programs'
    ? { read: PROGRAMS_READ_ALIAS, write: PROGRAMS_WRITE_ALIAS }
    : { read: EXERCISES_READ_ALIAS, write: EXERCISES_WRITE_ALIAS };
}
