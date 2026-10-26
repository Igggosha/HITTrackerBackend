import { assertMediaReady, initialLikesAdjustment, parseCatalogImportArgs, preservedLikesAdjustment, sameCatalogShape } from './catalog-import.logic';

describe('catalog import safety',()=>{
  it('defaults to dry-run and rejects unknown flags',()=>{
    expect(parseCatalogImportArgs([])).toEqual({apply:false,adoptLegacy:false,allowMissingMedia:false});
    expect(()=>parseCatalogImportArgs(['--force'])).toThrow('Unknown argument');
  });

  it('blocks apply while media is incomplete unless explicitly overridden',()=>{
    const items=[{media:{status:'ready'}},{media:{status:'missing'}}];
    expect(assertMediaReady(items,false,false)).toBe(1);
    expect(()=>assertMediaReady(items,true,false)).toThrow('Refusing apply');
    expect(assertMediaReady(items,true,true)).toBe(1);
  });

  it('detects a real canonical content change',()=>{
    expect(sameCatalogShape({items:[1,2]},{items:[1,2]})).toBe(true);
    expect(sameCatalogShape({items:[1,2]},{items:[2,1]})).toBe(false);
  });

  it('seeds a desired total and preserves it across program revisions',()=>{
    expect(initialLikesAdjustment(40, 7)).toBe(33);
    expect(preservedLikesAdjustment(7, 33)).toBe(33);
    expect(preservedLikesAdjustment(2, -5)).toBe(-2);
  });
});
