import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeInput} from '../src/index.js';
test('accepts names scoped to each platform and rejects invalid selections',()=>{
  const data = {extra:{douyin:{collection:'知识科普'},xiaohongshu:{collection:'摄影',group:'交流群',location:'北京'}}};
  const input = {type:'shortVideo',platforms:['douyin','xiaohongshu'],data};
  assert.deepEqual(normalizeInput(input).data,data);
  for (const value of ['',false,{}]) assert.throws(()=>normalizeInput({...input,data:{extra:{douyin:{collection:value}}}}),/collection/);
  assert.throws(()=>normalizeInput({...input,data:{personalDeclaration:true,extra:{xiaohongshu:{contentDeclaration:'内容来源声明 / 来源转载'}}}}),/原创声明/);
});

test('named collection reaches the extension with the other destinations', async () => {
 const destinations = {collection:{mode:'select',name:'景点拍照万能姿势'},location:{mode:'keyword',keyword:'北京地坛公园'}};
 const input = {type:'imageText',platforms:['xiaohongshu'],data:{extra:{publishDestinations:destinations}}};
 const normalized = normalizeInput(input);
 assert.deepEqual(normalized.data.extra.publishDestinations,destinations);
});
