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
