import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { startNativeHost } from '../src/native-host.js';
import { NativeMessageParser, encodeNativeMessage } from '../src/native-framing.js';

test('文档双向通道只接受当前桥身份，并保持 Native 帧完整',async t=>{
  const registryPath=await fs.mkdtemp(path.join(os.tmpdir(),'yijianfa-service-bridge-'));
  const stdin=new PassThrough(),stdout=new PassThrough(),frames=[],calls=[];
  const parser=new NativeMessageParser();stdout.on('data',chunk=>frames.push(...parser.push(chunk)));
  const starting=startNativeHost({stdin,stdout,stderr:new PassThrough(),browserContext:null,registryPath,callerOrigin:'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/',documentServiceFactory:()=>({async handle(op,payload){calls.push({op,payload});return{connections:[]};},async close(){}})});
  stdin.write(encodeNativeMessage({protocolVersion:1,kind:'bridge_registration',browserContext:'regular',installationId:randomUUID()}));
  const host=await starting;
  t.after(async()=>{await host.close();await fs.rm(registryPath,{recursive:true,force:true});});
  const ready=frames.find(frame=>frame.kind==='bridge_ready');assert.ok(ready);
  const message={kind:'local_service_request',protocolVersion:1,id:'document-test',service:'feishu_documents',operation:'connections',payload:{},browserContext:'regular',bridgeTarget:ready.bridgeTarget};
  stdin.write(encodeNativeMessage({...message,id:'wrong-instance',bridgeTarget:{...ready.bridgeTarget,instanceId:randomUUID()}}));
  stdin.write(encodeNativeMessage(message));
  const end=Date.now()+2000;while(!frames.some(frame=>frame.id==='document-test')){if(Date.now()>end)throw Error('未收到本机响应');await new Promise(r=>setTimeout(r,5));}
  assert.equal(calls.length,1);const response=frames.find(frame=>frame.id==='document-test');assert.equal(response.kind,'local_service_response');assert.equal(response.ok,true);assert.deepEqual(response.result,{connections:[]});assert.equal(frames.some(frame=>frame.id==='wrong-instance'),false);
});
