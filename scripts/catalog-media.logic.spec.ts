import { exerciseNameSimilarity, SAFE_MEDIA_NAME_SCORE } from './catalog-media.logic';

describe('catalog media matching',()=>{
  it('matches reordered names and harmless plurals',()=>{
    expect(exerciseNameSimilarity('Barbell Bent-Over Row','Bent Over Barbell Row')).toBe(1);
    expect(exerciseNameSimilarity('Dumbbell Shoulder Press','Shoulder Press, Dumbbells')).toBe(1);
  });

  it('rejects a shared generic word when the movement differs',()=>{
    expect(exerciseNameSimilarity('Machine Calf Raise','Machine Lateral Raise')).toBeLessThan(SAFE_MEDIA_NAME_SCORE);
    expect(exerciseNameSimilarity('Reverse Curl','Reverse Nordic Curl')).toBeLessThan(SAFE_MEDIA_NAME_SCORE);
  });
});
