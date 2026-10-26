import { readFile, writeFile } from 'node:fs/promises';
import { exerciseNameSimilarity, normalizeExerciseName, SAFE_MEDIA_NAME_SCORE } from './catalog-media.logic';

type CatalogExercise={catalogKey:string;name:{en:string};aliases:{en:string[]};equipment:{required:string[];alternatives:string[][]}};
type WgerImage={id:number;image:string;is_main:boolean;license:number;license_author:string;license_author_url:string;license_object_url:string};
type WgerExercise={id:number;translations:{language:number;name:string}[];equipment:{name:string}[];images:WgerImage[]};
type License={id:number;full_name:string;short_name:string;url:string};
type FreeExercise={id:string;name:string;equipment:string|null;images:string[]};

const normalize=normalizeExerciseName;
const equipmentAliases:Record<string,string[]>={
  barbell:['barbell'],dumbbells:['dumbbell'],bench:['bench'],machine:['machine'],
  'cable machine':['cable'],kettlebell:['kettlebell'],'resistance band':['band'],
  'pull-up bar':['pull up bar'], 'parallel bars':['parallel bars'], platform:['bench','step'],
};
const freeExerciseOverrides: Record<string, string> = {
  barbell_bench_press: 'Barbell_Bench_Press_-_Medium_Grip',
  incline_barbell_press: 'Barbell_Incline_Bench_Press_-_Medium_Grip',
  chest_dip: 'Dips_-_Chest_Version',
  dumbbell_fly: 'Dumbbell_Flyes',
  dumbbell_pullover: 'Bent-Arm_Dumbbell_Pullover',
  pull_up: 'Pullups',
  single_arm_dumbbell_row: 'One-Arm_Dumbbell_Row',
  conventional_deadlift: 'Barbell_Deadlift',
  arnold_press: 'Arnold_Dumbbell_Press',
  machine_shoulder_press: 'Machine_Shoulder_Military_Press',
  dumbbell_lateral_raise: 'Side_Lateral_Raise',
  reverse_pec_deck: 'Reverse_Machine_Flyes',
  dumbbell_curl: 'Dumbbell_Bicep_Curl',
  reverse_curl: 'Reverse_Barbell_Curl',
  triceps_dip: 'Dips_-_Triceps_Version',
  farmers_carry: 'Farmers_Walk',
  barbell_wrist_curl: 'Palms-Up_Barbell_Wrist_Curl_Over_A_Bench',
  barbell_reverse_wrist_curl: 'Palms-Down_Wrist_Curl_Over_A_Bench',
  dumbbell_wrist_curl: 'Palms-Up_Dumbbell_Wrist_Curl_Over_A_Bench',
  reverse_wrist_curl: 'Palms-Down_Dumbbell_Wrist_Curl_Over_A_Bench',
  hip_thrust: 'Barbell_Hip_Thrust',
  barbell_back_squat: 'Barbell_Full_Squat',
  back_extension: 'Hyperextensions_Back_Extensions',
  dumbbell_calf_raise: 'Standing_Dumbbell_Calf_Raise',
  machine_chest_press: 'Leverage_Chest_Press',
  lat_pulldown: 'Full_Range-Of-Motion_Lat_Pulldown',
  t_bar_row: 'T-Bar_Row_with_Handle',
  bent_over_dumbbell_reverse_fly: 'Reverse_Flyes',
  cable_curl: 'Standing_Biceps_Cable_Curl',
  cable_triceps_pushdown: 'Triceps_Pushdown',
  skull_crusher: 'EZ-Bar_Skullcrusher',
  overhead_dumbbell_triceps_extension: 'Seated_Triceps_Press',
  single_arm_triceps_extension: 'Dumbbell_One-Arm_Triceps_Extension',
  crunch: 'Crunches',
  incline_crunch: 'Decline_Crunch',
  leg_raise: 'Flat_Bench_Lying_Leg_Raise',
  side_plank: 'Side_Bridge',
  bicycle_crunch: 'Air_Bike',
  bulgarian_split_squat: 'Split_Squat_with_Dumbbells',
  machine_calf_raise: 'Standing_Calf_Raises',
  barbell_calf_raise: 'Standing_Barbell_Calf_Raise',
  side_lying_leg_raise: 'Side_Leg_Raises',
  forward_lunge_general: 'Bodyweight_Walking_Lunge',
  forward_lunge: 'Dumbbell_Lunges',
  step_up: 'Step-up_with_Knee_Raise',
  hanging_knee_raise: 'Hanging_Leg_Raise',
  leg_press_calf_raise: 'Calf_Press_On_The_Leg_Press_Machine',
};
const equipmentScore=(catalog:CatalogExercise,wger:WgerExercise)=>{
  const available=wger.equipment.map((item)=>normalize(item.name));
  const wanted=[...catalog.equipment.required,...catalog.equipment.alternatives.flat()];
  return wanted.reduce((score,item)=>score+((equipmentAliases[item]??[item]).some((alias)=>available.some((name)=>name.includes(alias)))?1:0),0);
};
async function getJson<T>(url:string):Promise<T>{ const response=await fetch(url); if(!response.ok) throw new Error(`${response.status} ${url}`); return response.json() as Promise<T>; }

async function main(){
  const catalog=JSON.parse(await readFile('data/catalog/catalog.normalized.json','utf8')) as {exercises:CatalogExercise[]};
  const [{results:exercises},{results:licenses},freeExercises]=await Promise.all([
    getJson<{results:WgerExercise[]}>('https://wger.de/api/v2/exerciseinfo/?limit=1000'),
    getJson<{results:License[]}>('https://wger.de/api/v2/license/?limit=100'),
    getJson<FreeExercise[]>('https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json'),
  ]);
  const licenseById=new Map(licenses.map((license)=>[license.id,license]));
  const registry=catalog.exercises.map((exercise)=>{
    const names=[exercise.name.en,...exercise.aliases.en];
    const candidates=exercises.flatMap((candidate)=>{
      if(!candidate.images.length) return [];
      const englishNames=candidate.translations.filter((translation)=>translation.language===2).map((translation)=>translation.name);
      const scored=englishNames.map((name)=>({name,score:Math.max(...names.map((catalogName)=>exerciseNameSimilarity(catalogName,name)))})).sort((a,b)=>b.score-a.score)[0];
      return scored&&scored.score>=SAFE_MEDIA_NAME_SCORE?[{candidate,matchedName:scored.name,nameScore:scored.score,equipmentScore:equipmentScore(exercise,candidate)}]:[];
    }).sort((a,b)=>b.nameScore-a.nameScore||b.equipmentScore-a.equipmentScore||Number(b.candidate.images.some((image)=>image.is_main))-Number(a.candidate.images.some((image)=>image.is_main)));
    const selected=candidates[0];
    const match=selected?.candidate;
    const image=match?.images.find((item)=>item.is_main)??match?.images[0];
    const license=image?licenseById.get(image.license):undefined;
    const overriddenFreeExercise = freeExercises.find(
      (candidate) => candidate.id === freeExerciseOverrides[exercise.catalogKey],
    );
    const freeMatch=!image?(overriddenFreeExercise
      ? { candidate: overriddenFreeExercise, score: 1 }
      : freeExercises.map((candidate)=>({candidate,score:Math.max(...names.map((name)=>exerciseNameSimilarity(name,candidate.name)))})).filter((item)=>item.candidate.images.length&&item.score>=SAFE_MEDIA_NAME_SCORE).sort((a,b)=>b.score-a.score)[0]):undefined;
    const freeImage=freeMatch?.candidate.images[0];
    return {
      catalogKey:exercise.catalogKey,
      image:image?{
        status:'candidate', localFile:null, objectKey:null, source:image.image,
        sourcePage:`https://wger.de/en/exercise/${match.id}/view`, sourceExerciseId:match.id,
        matchedName:selected.matchedName, nameScore:Number(selected.nameScore.toFixed(3)), equipmentScore:selected.equipmentScore,
        license:license?.short_name??null, licenseUrl:license?.url??null,
        attribution:image.license_author||null, attributionUrl:image.license_author_url||null,
        licenseObjectUrl:image.license_object_url||null,
      }:freeImage?{
        status:'candidate',localFile:null,objectKey:null,
        source:`https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/${freeImage}`,
        sourcePage:`https://github.com/yuhonas/free-exercise-db/tree/main/exercises/${freeMatch.candidate.id}`,
        sourceExerciseId:freeMatch.candidate.id,matchedName:freeMatch.candidate.name,nameScore:Number(freeMatch.score.toFixed(3)),equipmentScore:null,
        license:'Unlicense',licenseUrl:'https://unlicense.org/',attribution:'yuhonas/free-exercise-db contributors',attributionUrl:'https://github.com/yuhonas/free-exercise-db',licenseObjectUrl:null,
      }:{status:'missing',localFile:null,objectKey:null,source:null,sourcePage:null,sourceExerciseId:null,matchedName:null,nameScore:null,equipmentScore:null,license:null,licenseUrl:null,attribution:null,attributionUrl:null,licenseObjectUrl:null},
      videos:{en:{status:'missing',url:null,channel:null},uk:{status:'missing',url:null,channel:null}},
    };
  });
  await writeFile('data/catalog/media-registry.json',JSON.stringify({version:1,generatedAt:new Date().toISOString(),sources:['wger public API; each candidate retains its per-file license metadata','yuhonas/free-exercise-db; repository declares the dataset and images under the Unlicense'],entries:registry},null,2)+'\n','utf8');
  const found=registry.filter((entry)=>entry.image.status==='candidate').length;
  console.log(`media candidates: ${found}/${registry.length}; missing: ${registry.length-found}`);
}

main().catch((error)=>{console.error(error);process.exitCode=1;});
