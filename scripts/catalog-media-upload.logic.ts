export type RegistryImage = {
  status: string;
  source: string | null;
  objectKey: string | null;
};

export function parseMediaUploadArgs(argv: string[]) {
  const allowed = new Set(['--apply']);
  for (const argument of argv) {
    if (!allowed.has(argument))
      throw new Error(`Unknown argument: ${argument}`);
  }
  return { apply: argv.includes('--apply') };
}

export function uploadableEntries<T extends { image: RegistryImage }>(
  entries: T[],
) {
  return entries.filter(
    ({ image }) =>
      image.status === 'candidate' && Boolean(image.source) && !image.objectKey,
  );
}
