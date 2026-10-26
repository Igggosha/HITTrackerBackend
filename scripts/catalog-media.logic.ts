export const normalizeExerciseName=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(' ').map((token)=>token.length>3&&token.endsWith('s')?token.slice(0,-1):token).join(' ');

export const exerciseNameSimilarity=(left:string,right:string)=>{
  const a=new Set(normalizeExerciseName(left).split(' '));
  const b=new Set(normalizeExerciseName(right).split(' '));
  const shared=[...a].filter((token)=>b.has(token)).length;
  return shared/Math.max(a.size,b.size,1);
};

export const SAFE_MEDIA_NAME_SCORE=0.8;
