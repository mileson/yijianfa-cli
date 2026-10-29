import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeInput} from '../src/index.js';
test('collection preselection rejects legacy task fields',()=>{
 for(const collection of ['', '知识科普', false]) assert.throws(()=>normalizeInput({type:'shortVideo',platforms:['douyin'],data:{extra:{douyin:{collection}}}}),/合集预选已停用/);
});
