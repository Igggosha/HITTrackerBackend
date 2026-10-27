import { readFile } from 'node:fs/promises';

const fail = (message: string): never => { throw new Error(message); };
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const key = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(v);
const mediaOk = (m: any) => m?.status === 'missing' && m.demonstrationImage?.localFile === null && m.demonstrationImage?.source === null && m.demonstrationImage?.license === null && m.demonstrationImage?.attribution === null && m.videos?.en === null && m.videos?.uk === null;

export function validateCatalog(source: any, catalog: any): void {
  if (source.exerciseRows.length !== 110) fail('expected 110 source rows');
  if (catalog.exercises.length !== 104) fail('expected 104 exercises');
  if (catalog.programs.length !== 20) fail('expected 20 programs');
  if (new Set(catalog.exercises.map((e:any) => e.catalogKey)).size !== 104) fail('exercise keys are not unique');
  const nodes = catalog.exercises.flatMap((e:any) => e.sourceNodeIds);
  const sourceNodes = source.exerciseRows.map((r:any) => r.sourceNodeId);
  if (nodes.length !== 110 || new Set(nodes).size !== 110 || [...nodes].sort().join() !== [...sourceNodes].sort().join()) fail('source nodes are not mapped exactly once');
  for (const e of catalog.exercises) {
    if (!key(e.catalogKey) || !Array.isArray(e.sourceNodeIds) || !text(e.name?.en) || !text(e.name?.uk)) fail(`invalid exercise identity: ${e.catalogKey}`);
    if (!text(e.description?.en) || !text(e.description?.uk) || e.description.en === e.description.uk) fail(`invalid exercise descriptions: ${e.catalogKey}`);
    if (!Array.isArray(e.aliases?.en) || !Array.isArray(e.aliases?.uk) || !text(e.muscles?.primary?.en) || !text(e.muscles?.primary?.uk) || !Array.isArray(e.muscles?.secondary)) fail(`invalid muscles: ${e.catalogKey}`);
    if (e.muscles.primary.en === 'Other' || e.muscles.secondary.some((m:any) => m.en === 'Other')) fail(`unmapped muscle: ${e.catalogKey}`);
    if (!Array.isArray(e.equipment?.required) || !Array.isArray(e.equipment?.alternatives) || ![1,2,3,4,5].includes(e.difficulty) || !Number.isInteger(e.initialLikes) || e.initialLikes < 0 || e.initialLikes > 40 || !['reps','duration'].includes(e.measurementType)) fail(`invalid exercise invariants: ${e.catalogKey}`);
    if (!Number.isInteger(e.recommendations?.sets) || e.recommendations.sets < 1) fail(`missing recommended sets: ${e.catalogKey}`);
    if (e.measurementType === 'reps' && (!Number.isInteger(e.recommendations?.reps) || e.recommendations.reps < 1 || e.recommendations.duration !== null)) fail(`invalid repetition recommendation: ${e.catalogKey}`);
    if (e.measurementType === 'duration' && (!Number.isInteger(e.recommendations?.duration) || e.recommendations.duration < 1 || e.recommendations.reps !== null)) fail(`invalid duration recommendation: ${e.catalogKey}`);
    if (!mediaOk(e.media)) fail(`media must be explicit missing placeholder: ${e.catalogKey}`);
    if (e.muscles.secondary.some((m:any) => m.en === e.muscles.primary.en || m.uk === e.muscles.primary.uk)) fail(`primary muscle repeated as secondary: ${e.catalogKey}`);
    if (/\p{Script=Cyrillic}/u.test(e.description.en)) fail(`English description contains non-English text: ${e.catalogKey}`);
    if (e.measurementType === 'reps' && /\b(seconds?|sec)\b/i.test(e.description.en)) fail(`repetition exercise stores duration wording: ${e.catalogKey}`);
    for (const part of [/^Set up /, /Breathe/, /torso/, /avoid/]) if (!part.test(e.description.en)) fail(`incomplete English instructions: ${e.catalogKey}`);
    if (e.catalogKey === 'front_plank' && e.measurementType !== 'duration') fail('front_plank must measure duration');
    if (e.catalogKey === 'hanging_knee_raise' && e.measurementType !== 'reps') fail('hanging_knee_raise must measure repetitions');
    if (e.catalogKey === 'chest_dip' && e.name.en === 'Triceps Dip') fail('chest_dip identity drifted');
    if (e.catalogKey === 'triceps_dip' && e.name.en !== 'Triceps Dip') fail('triceps_dip identity missing');
    if (e.catalogKey === 'conventional_deadlift' && e.name.en !== 'Conventional Deadlift') fail('conventional_deadlift identity missing');
    if (e.catalogKey === 'romanian_deadlift' && e.name.en !== 'Romanian Deadlift') fail('romanian_deadlift identity missing');
    if (['face_pull','hammer_curl','bulgarian_split_squat','step_up','forward_lunge','reverse_lunge','reverse_curl'].includes(e.catalogKey) && !text(e.description.en)) fail(`critical exercise missing: ${e.catalogKey}`);
    if (/bodyweight/i.test(e.name.en) && e.equipment.required.length) fail(`bodyweight must not require equipment: ${e.catalogKey}`);
    if (e.catalogKey === 'step_up' && JSON.stringify(e.equipment.alternatives) !== JSON.stringify([['platform','box','bench']])) fail('step_up equipment alternatives are incomplete');
  }
  for (const language of ['en', 'uk']) {
    const descriptions = catalog.exercises.map((e: any) => e.description[language]);
    if (new Set(descriptions).size < descriptions.length - 2) fail(`too many duplicate ${language} descriptions`);
  }
  const refs = new Set(catalog.exercises.map((e:any) => e.catalogKey));
  for (const p of catalog.programs) {
    if (!key(p.catalogKey) || !text(p.name?.en) || !text(p.name?.uk) || !text(p.description?.en) || !text(p.description?.uk) || p.official !== true || p.active !== true || !Number.isInteger(p.initialLikes) || p.initialLikes < 0 || p.initialLikes > 40 || p.exerciseCatalogKeys?.length !== 5 || p.exerciseCatalogKeys.some((k:string) => !refs.has(k)) || !mediaOk(p.media)) fail(`invalid program: ${p.catalogKey}`);
  }
  if (new Set(catalog.programs.map((p:any) => p.description.en)).size !== 20 || new Set(catalog.programs.map((p:any) => p.description.uk)).size !== 20) fail('program descriptions must be unique');
  if (new Set(catalog.programs.map((p:any) => p.catalogKey)).size !== 20) fail('program keys are not unique');
  if (!catalog.muscles.length || catalog.muscles.some((m:any) => !key(m.catalogKey) || !text(m.name?.en) || !text(m.name?.uk))) fail('invalid muscles catalog');
}

async function main() {
  const source = JSON.parse(await readFile('data/catalog/figma-source.json', 'utf8'));
  const catalog = JSON.parse(await readFile('data/catalog/catalog.normalized.json', 'utf8'));
  validateCatalog(source, catalog);
  console.log(`catalog valid: ${catalog.exercises.length} exercises, ${catalog.programs.length} programs, ${source.exerciseRows.length} source mappings`);
}
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
