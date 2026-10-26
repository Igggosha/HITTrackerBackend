export const CATALOG_IMPORT_ARGUMENTS = ['--apply','--adopt-legacy','--allow-missing-media'] as const;

export function parseCatalogImportArgs(argv:string[]){
  const args=new Set(argv);
  for(const arg of args) if(!(CATALOG_IMPORT_ARGUMENTS as readonly string[]).includes(arg)) throw new Error(`Unknown argument: ${arg}`);
  return {apply:args.has('--apply'),adoptLegacy:args.has('--adopt-legacy'),allowMissingMedia:args.has('--allow-missing-media')};
}

export function assertMediaReady(items:{media:{status:string}}[],apply:boolean,allowMissingMedia:boolean){
  const missing=items.filter((item)=>item.media.status!=='ready').length;
  if(apply&&missing&&!allowMissingMedia) throw new Error(`Refusing apply: ${missing} catalog records still have missing media.`);
  return missing;
}

export const sameCatalogShape=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);

export const initialLikesAdjustment = (initial: number, actual: number) => initial - actual;

export const preservedLikesAdjustment = (actual: number, adjustment: number) =>
  Math.max(0, actual + adjustment) - actual;

export const readyVideoUrl = (
  video: { status: string; url: string | null } | undefined,
  fallback: string | null,
) => (video?.status === 'ready' ? video.url : fallback);
