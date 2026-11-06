import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {catalog,buildPlan,fixedSizes,generate,extractImages,previewPlan,decodeBase64,windowsFetch} from './rolldek.mjs';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const readImage = async p=>({bytes:png,mime:'image/png',name:path.basename(p)});
const temporary = await fs.mkdtemp(path.join(os.tmpdir(),'rolldek-test-'));
const ref1 = path.join(temporary,'reference.png');
const ref2 = path.join(temporary,'reference2.png');
await fs.writeFile(ref1,png);
await fs.writeFile(ref2,png);
const profile = (id,mode='fixed',alias=id)=>({model:id,channel_mode:mode,key_alias:alias,api_group:id==='seedream-5.0'?'seedream':'',defaults:{}});
const response = (value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','X-Oneapi-Request-Id':'mock-request-id'}});
const dataImages = n=>({data:Array.from({length:n},()=>({b64_json:png.toString('base64')}))});

test('all ten supported models respect their generation and editing capabilities',async()=>{
  assert.equal(catalog.filter(m=>m.documented).length,10);
  for(const m of catalog.filter(m=>m.documented)) {
    const plain = await buildPlan({prompt:'test'},profile(m.id));
    if(m.family==='gpt26') {
      assert.equal(plain.path,'/v1/images/generations');
      assert.deepEqual(plain.body,{model:m.id,prompt:'test'});
      await assert.rejects(buildPlan({prompt:'edit',references:[ref1]},profile(m.id),{readImage}),/文生图/);
      continue;
    }
    const edited = await buildPlan({prompt:'edit',references:[ref1,ref2]},profile(m.id),{readImage});
    if(m.family.startsWith('gemini-')) {
      assert.equal(plain.path,`/v1beta/models/${m.id}:generateContent`);
      assert.equal(plain.auth,'google');
      assert.equal(edited.body.contents[0].parts.length,3);
      assert.equal(edited.body.contents[0].parts[1].inlineData.mimeType,'image/png');
    } else if(m.family==='seedream') {
      assert.equal(edited.path,'/v1/images/generations');
      assert.equal(edited.body.images.length,2);
      assert.equal(edited.body.image,undefined);
    } else {
      assert.equal(plain.path,'/v1/images/generations');
      assert.equal(edited.path,'/v1/images/edits');
      assert.equal(edited.encoding,'multipart');
      assert.deepEqual(edited.files.map(f=>f.field),['image[]','image[]']);
    }
  }
});
test('GPT2.6 S sends native resolution, quality and complexity settings and generates serially',async()=>{
  const current=profile('gpt-image-2.6-sunburst');
  const plan=await buildPlan({prompt:'red apple',count:3},current);
  assert.deepEqual(plan.body,{model:'gpt-image-2.6-sunburst',prompt:'red apple'});
  assert.equal(plan.repetitions,3);
  const configured={...current,defaults:{resolution:'2K',quality:'xhigh',complexity:'high'}};
  const native=await buildPlan({prompt:'test',aspect_ratio:'3:4'},configured);
  assert.deepEqual(native.body,{model:current.model,prompt:'test',size:'1536x2048',quality:'xhigh',complexity:'high'});
  const landscape=await buildPlan({prompt:'test',aspect_ratio:'3:2',resolution:'2K'},current);
  assert.equal(landscape.body.size,'2016x1344');
  const exact=await buildPlan({prompt:'test',size:'1536x1024',quality:'low',complexity:'medium'},configured);
  assert.deepEqual(exact.body,{model:current.model,prompt:'test',size:'1536x1024',quality:'low',complexity:'medium'});
  for(const level of ['1K','2K','4K']) for(const quality of ['auto','low','medium','high','xhigh','max']) {
    const p=await buildPlan({prompt:'test',resolution:level,quality,complexity:'low'},current);
    assert.equal(p.body.size,{ '1K':'1024x1024','2K':'2048x2048','4K':'4096x4096' }[level]);
    assert.equal(p.body.quality,quality);
    assert.equal(p.body.complexity,'low');
  }
  for(const fields of [{size:'1025x1024'},{aspect_ratio:'4:1',resolution:'2K'},{quality:'hd'},{complexity:'max'}]) await assert.rejects(buildPlan({prompt:'test',...fields},current));
  await assert.rejects(buildPlan({prompt:'test',background:'transparent'},current),/未文档化支持参数/);
  await assert.rejects(buildPlan({prompt:'test',complexity:'high'},profile('gpt-image-2.5-sunburst')),/complexity/);
  let submissions=0;
  const config={default_profile:'gpt2.6-s',profiles:{'gpt2.6-s':configured}};
  const result=await generate({prompt:'two apples',aspect_ratio:'3:4',count:2,output_dir:temporary},config,{keyLoader:async()=> 'synthetic-gpt26-key',fetchImpl:async(url,options)=>{
    submissions++;
    assert.equal(url,'https://rolldek.com/v1/images/generations');
    assert.deepEqual(JSON.parse(options.body),{model:'gpt-image-2.6-sunburst',prompt:'two apples',size:'1536x2048',quality:'xhigh',complexity:'high'});
    return response(dataImages(1));
  }});
  assert.equal(submissions,2);
  assert.equal(result.images.length,2);
  for(const image of result.images)assert.deepEqual(await fs.readFile(image.path),png);
});

test('nonofficial GPT2.5 omits n for both one and multiple images, and uses the fixed pixel table',async()=>{
  for(const id of ['gpt-image-2.5','gpt-image-2.5-flare','gpt-image-2.5-sunburst']) {
    for(const count of [1,3]) {
      const p=await buildPlan({prompt:'t',count},profile(id));
      assert.equal('n' in p.body,false);
      assert.equal(p.repetitions,count);
    }
  }
  for(const [ratio,sizes] of Object.entries(fixedSizes)) for(const [i,size] of sizes.entries()) {
    const p=await buildPlan({prompt:'t',aspect_ratio:ratio,resolution:['1K','2K','4K'][i]},profile('gpt-image-2.5-sunburst'));
    assert.equal(p.body.size,size);
  }
  await assert.rejects(buildPlan({prompt:'t',resolution:'2K'},profile('gpt-image-2.5')),/分辨率/);
  await assert.rejects(buildPlan({prompt:'t',size:'5504x3072'},profile('gpt-image-2.5-flare')),/固定尺寸/);
  await assert.rejects(buildPlan({prompt:'t'},profile('gpt-image-2.5-flare','unknown')),/确认/);
});
test('official GPT2.5 validates dimensions and supports batch n, transparency and masks',async()=>{
  const p=await buildPlan({prompt:'t',count:2,size:'2048x1152',background:'transparent',output_format:'webp',references:[ref1],mask:ref2,input_fidelity:'high'},profile('gpt-image-2.5-flare','official'),{readImage});
  assert.equal(p.body.n,2); assert.equal(p.repetitions,1);
  assert.equal('response_format' in p.body,false);
  assert.equal(p.files[1].field,'mask');
  await assert.rejects(buildPlan({prompt:'t',size:'1025x1024'},profile('gpt-image-2.5-flare','official')),/16倍数/);
  await assert.rejects(buildPlan({prompt:'t',background:'transparent',output_format:'jpeg'},profile('gpt-image-2.5-flare')),/透明/);
});
test('GPT2.5 JSON references retain URL/file IDs and reject ambiguous reference forms',async()=>{
  const p=await buildPlan({prompt:'t',image_references:[{image_url:'https://example.com/image.png'},{file_id:'file-test'}],mask_reference:{file_id:'mask-test'}},profile('gpt-image-2.5-sunburst'));
  assert.equal(p.encoding,'json'); assert.equal(p.body.images[1].file_id,'file-test');
  assert.deepEqual(p.body.mask,{file_id:'mask-test'});
  await assert.rejects(buildPlan({prompt:'t',image_references:[{image_url:'https://example.com/a',file_id:'f'}]},profile('gpt-image-2.5-flare')),/只含/);
});
test('Gemini nests RollDek responseFormat fields and supports ultrawide only on Flash',async()=>{
  const p=await buildPlan({prompt:'t',aspect_ratio:'8:1',resolution:'2k',count:3},profile('gemini-3.1-flash-image-preview'));
  assert.deepEqual(p.body.generationConfig,{responseModalities:['IMAGE'],responseFormat:{image:{aspectRatio:'8:1',imageSize:'2K'}}});
  assert.equal(p.repetitions,3); assert.equal(p.body.n,undefined);
  await assert.rejects(buildPlan({prompt:'t',aspect_ratio:'8:1'},profile('gemini-3-pro-image-preview')),/比例/);
  await assert.rejects(buildPlan({prompt:'t',references:Array(15).fill(ref1)},profile('gemini-3-pro-image-preview'),{readImage}),/14/);
});
test('Nano Banana 2.1 keeps the native endpoint, image settings, ordered references and optional thinking level',async()=>{
  const p=await buildPlan({prompt:'edit',aspect_ratio:'9:16',resolution:'2K',references:[ref1],thinking_level:'high'},profile('gemini-nano-banana-2.1'),{readImage});
  assert.equal(p.path,'/v1beta/models/gemini-nano-banana-2.1:generateContent');
  assert.equal(p.auth,'google');
  assert.deepEqual(p.body.generationConfig,{responseModalities:['IMAGE'],thinkingConfig:{thinkingLevel:'high'},responseFormat:{image:{aspectRatio:'9:16',imageSize:'2K'}}});
  assert.equal(p.body.contents[0].parts[0].text,'edit');
  assert.equal(p.body.contents[0].parts[1].inlineData.data,png.toString('base64'));
  assert.equal(p.body.n,undefined);
  const plain=await buildPlan({prompt:'t',aspect_ratio:'8:1'},profile('gemini-nano-banana-2.1'));
  assert.equal(plain.body.generationConfig.thinkingConfig,undefined);
  assert.equal(plain.body.generationConfig.responseFormat.image.aspectRatio,'8:1');
  await assert.rejects(buildPlan({prompt:'t',thinking_level:'max'},profile('gemini-nano-banana-2.1')),/思考等级/);
  await assert.rejects(buildPlan({prompt:'t',thinking_level:'high'},profile('gemini-3-pro-image-preview')),/thinking_level/);
});

test('Seedream separates resolution and aspect ratio and sends a single reference through image',async()=>{
  const p=await buildPlan({prompt:'t',resolution:'2K',aspect_ratio:'16:9',references:[ref1],count:4},profile('seedream-5.0'),{readImage});
  assert.equal(p.body.resolution,'2k');assert.equal(p.body.size,'16:9');assert.equal(p.body.n,4);
  assert.ok(p.body.image.startsWith('data:image/png;base64,'));assert.equal(p.body.images,undefined);
  await assert.rejects(buildPlan({prompt:'t',size:'1024x1024'},profile('seedream-5.0')),/比例/);
});

test('profile resolution and quality defaults are applied and task parameters take precedence',async()=>{
  for(const mode of ['fixed','official']) {
    const current={...profile('gpt-image-2.5-sunburst',mode),defaults:{resolution:'2K',quality:'xhigh'}};
    const stored=await buildPlan({prompt:'t'},current);
    assert.equal(stored.body.size,'2048x2048');
    assert.equal(stored.body.quality,'xhigh');
    const task=await buildPlan({prompt:'t',aspect_ratio:'9:16',resolution:'1K',quality:'low'},current);
    assert.equal(task.body.size,'720x1280');
    assert.equal(task.body.quality,'low');
    const exact=await buildPlan({prompt:'t',size:'2048x1152'},current);
    assert.equal(exact.body.size,'2048x1152');
    assert.equal(exact.body.quality,'xhigh');
    assert.deepEqual(current.defaults,{resolution:'2K',quality:'xhigh'});
  }
  const banana={...profile('gemini-nano-banana-2.1'),defaults:{resolution:'4K',thinking_level:'high'}};
  const native=await buildPlan({prompt:'t',resolution:'2K'},banana);
  assert.deepEqual(native.body.generationConfig,{responseModalities:['IMAGE'],thinkingConfig:{thinkingLevel:'high'},responseFormat:{image:{imageSize:'2K'}}});
  const seedream={...profile('seedream-5.0'),defaults:{size:'3:4',resolution:'2K'}};
  const withSize=await buildPlan({prompt:'t',size:'16:9'},seedream);
  assert.equal(withSize.body.resolution,'2k');
  assert.equal(withSize.body.size,'16:9');
  const withRatio=await buildPlan({prompt:'t',aspect_ratio:'9:16'},seedream);
  assert.equal(withRatio.body.size,'9:16');
});

test('GPT resolution defaults follow local reference dimensions and validate custom official sizes',async()=>{
  const portrait=Buffer.from(png);
  portrait.writeUInt32BE(768,16);portrait.writeUInt32BE(1024,20);
  for(const mode of ['fixed','official']) {
    let reads=0;
    const current={...profile('gpt-image-2.5-sunburst',mode),defaults:{resolution:'2K',quality:'high'}};
    const plan=await buildPlan({prompt:'edit',references:[ref1]},current,{readImage:async()=>{reads++;return {bytes:portrait,mime:'image/png',name:'portrait.png'};}});
    assert.equal(plan.body.size,'1536x2048');
    assert.equal(plan.path,'/v1/images/edits');
    assert.equal(reads,1);
    assert.equal(plan.body.resolution,undefined);
    await assert.rejects(buildPlan({prompt:'edit',image_references:[{file_id:'f'}]},current),/指定 aspect_ratio 或 size/);
  }
  for(const [ratio,sizes] of Object.entries(fixedSizes)) for(const [i,size] of sizes.entries()) {
    const plan=await buildPlan({prompt:'t',aspect_ratio:ratio,resolution:['1K','2K','4K'][i]},profile('gpt-image-2.5-sunburst','official'));
    assert.equal(plan.body.size,size);
  }
  const arbitrary=await buildPlan({prompt:'t',aspect_ratio:'5:4',resolution:'4K'},profile('gpt-image-2.5-sunburst','official'));
  const [w,h]=arbitrary.body.size.split('x').map(Number);
  assert.equal(w%16,0);assert.equal(h%16,0);
  assert.ok(w*h<=3840*2160 && Math.max(w,h)<=3840);
  assert.ok(Math.abs(w/h-1.25)<0.02);
  await assert.rejects(buildPlan({prompt:'t',aspect_ratio:'5:4',resolution:'2K'},profile('gpt-image-2.5-sunburst')),/固定尺寸表/);
});
test('Gemini skips thought images and rejects corrupt base64',()=>{
  const im={mimeType:'image/png',data:png.toString('base64')};
  const images=extractImages({candidates:[{content:{parts:[{thought:true,inlineData:im},{text:'ok'},{inlineData:im}]}}]},'gemini-pro');
  assert.equal(images.length,1);assert.deepEqual(images[0].bytes,png);
  assert.throws(()=>decodeBase64('@@@'),/无效/);
});
test('dry-run never loads a key or sends a request, and redacts reference binary',async()=>{
  const c={profiles:{p:profile('gemini-3-pro-image-preview')},default_profile:'p'};
  const result=await generate({prompt:'t',references:[ref1]},c,{dryRun:true,keyLoader:()=>{throw Error('key access');},fetchImpl:()=>{throw Error('network');}});
  assert.equal(result.profile,'p');assert.equal(JSON.stringify(result).includes(png.toString('base64')),false);
  const multipart=await buildPlan({prompt:'t',references:[ref1]},profile('gpt-image-2'),{readImage});
  assert.equal(previewPlan(multipart).files[0].bytes,png.length);
});
test('two model profiles use distinct credentials; downloads never receive API credentials',async()=>{
  const c={profiles:{a:profile('gpt-image-2','fixed','key-a'),b:profile('seedream-5.0','fixed','key-b')},default_profile:'a'};
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    if(options.method==='GET') {assert.equal(options.headers,undefined);return new Response(png);}
    const b=JSON.parse(options.body);
    if(b.model==='seedream-5.0') return response({data:[{url:'https://example.com/result.png'}]});
    return response(dataImages(b.n));
  };
  for(const id of ['a','b']) {
    const result=await generate({profile:id,prompt:'t',output_dir:temporary},c,{fetchImpl,keyLoader:async p=>'synthetic-'+p.key_alias});
    assert.equal(result.status,'completed');assert.deepEqual(await fs.readFile(result.images[0].path),png);
  }
  const posts=calls.filter(c=>c.options.method==='POST');
  assert.equal(posts[0].options.headers.Authorization,'Bearer synthetic-key-a');
  assert.equal(posts[1].options.headers.Authorization,'Bearer synthetic-key-b');
});
test('multipart wire body retains ordered file fields; Gemini uses only google header',async()=>{
  const c={profiles:{a:profile('gpt-image-2'),b:profile('gemini-3-pro-image-preview')}};
  const fetchImpl=async(url,o)=>{
    if(url.includes('generateContent')) {
      assert.equal(o.headers['x-goog-api-key'],'synthetic');assert.equal(o.headers.Authorization,undefined);
      return response({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:png.toString('base64')}}]}}]});
    }
    assert.ok(o.body instanceof FormData);
    assert.deepEqual(o.body.getAll('image[]').map(f=>f.name),['reference.png','reference2.png']);
    assert.equal(o.headers['Content-Type'],undefined);
    return response(dataImages(1));
  };
  for(const id of ['a','b']) await generate({profile:id,prompt:'t',references:[ref1,ref2],output_dir:temporary},c,{fetchImpl,keyLoader:async()=>'synthetic'});
});
test('serial partial failure preserves saved images, redacts credentials and never retries POST',async()=>{
  let calls=0;
  const c={profiles:{p:profile('gpt-image-2.5-flare')},default_profile:'p'};
  const fetchImpl=async(url,o)=>{
    calls++;
    assert.equal('n' in JSON.parse(o.body),false);
    if(calls===1) return response(dataImages(1));
    return response({error:{code:'quota',message:'Denied Bearer synthetic-secret-value'}},429);
  };
  await assert.rejects(generate({prompt:'t',count:3,output_dir:temporary},c,{fetchImpl,keyLoader:async()=>'synthetic-secret-value'}),e=>{
    assert.equal(e.manifest.images.length,1);assert.equal(e.manifest.status,'failed');
    assert.equal(e.manifest.error.includes('synthetic-secret-value'),false);
    return true;
  });
  assert.equal(calls,2);
});
test('timeouts stop after one submission and download failures retain source URLs',async()=>{
  const c={profiles:{p:profile('seedream-5.0')},default_profile:'p'};
  let attempts=0;
  await assert.rejects(generate({prompt:'t',output_dir:temporary},c,{keyLoader:async()=>'synthetic',fetchImpl:async()=>{attempts++;throw Error('timeout');}}),/未自动重发/);
  assert.equal(attempts,1);
  await assert.rejects(generate({prompt:'t',output_dir:temporary},c,{keyLoader:async()=>'synthetic',fetchImpl:async(url,o)=>o.method==='POST'?response({data:[{url:'https://example.com/recover.png'}]}):new Response('',{status:503})}),e=>{
    assert.deepEqual(e.manifest.requests[0].output_urls,['https://example.com/recover.png']);return true;
  });
});
test('unknown models and arbitrary API destinations fail before reading credentials',async()=>{
  for(const id of ['gpt-image-2-official','gemini-3-pro-image','made-up-model']) await assert.rejects(buildPlan({prompt:'t'},profile(id)),/接口契约/);
  const c={api_base:'https://example.com',profiles:{p:profile('gpt-image-2')},default_profile:'p'};
  await assert.rejects(generate({prompt:'t'},c,{keyLoader:()=>{throw Error('leaked');}}),/API 地址/);
});
test('Windows HTTP bridge sends credentials only through stdin and serializes multipart with the matching boundary',async()=>{
  const spawnImpl=(cmd,args,settings)=>{
    assert.equal(settings.windowsHide,true);
    assert.equal(args.join(' ').includes('synthetic-secret'),false);
    const child=new EventEmitter();
    child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
    const chunks=[];child.stdin.on('data',c=>chunks.push(c));
    child.stdin.on('finish',()=>{
      const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(payload.headers.authorization,'Bearer synthetic-secret');
      assert.equal(payload.allow_redirect,false);
      const boundary=/boundary=(.+)$/.exec(payload.headers['content-type'])[1];
      const body=Buffer.from(payload.body_base64,'base64').toString('utf8');
      assert.ok(body.includes('--'+boundary));assert.ok(body.includes('name="image[]"'));assert.ok(body.includes('filename="reference.png"'));
      child.stdout.end(JSON.stringify({status:401,headers:{'Content-Type':'application/json'},body_base64:Buffer.from(JSON.stringify({error:{code:'missing'}})).toString('base64')}));
      setImmediate(()=>child.emit('close',0));
    });
    child.kill=()=>child.emit('close',1);
    return child;
  };
  const body=new FormData();body.append('image[]',new Blob([png],{type:'image/png'}),'reference.png');
  const result=await windowsFetch('https://rolldek.com/v1/images/edits',{method:'POST',headers:{Authorization:'Bearer synthetic-secret'},body,redirect:'error'},{spawnImpl});
  assert.equal(result.status,401);assert.equal(result.ok,false);assert.equal((await result.json()).error.code,'missing');
});
test('an aborted Windows request is never submitted',async()=>{
  const controller=new AbortController();controller.abort();
  let submissions=0;
  await assert.rejects(windowsFetch('https://rolldek.com/v1/images/generations',{method:'POST',body:'{}',signal:controller.signal},{spawnImpl:()=>{submissions++;}}),/提交前/);
  assert.equal(submissions,0);
});
test('TXT transfer preserves credentials and rejects invalid batches before any mutation', {skip:process.platform!=='win32'},async()=>{
  const result=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',path.join(here,'Model-Keys-Txt.Tests.ps1'),'-TempRoot',temporary],{windowsHide:true,encoding:'utf8'});
  assert.ok(result.stdout.includes('TXT transfer tests passed'));
});
test('Windows GUI saves masked credentials through DPAPI and round-trips explicit TXT transfers', {skip:process.platform!=='win32'},async()=>{
  const configPath=path.join(temporary,'gui','config.json');
  const result=await execFileAsync('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',path.join(here,'Configure-Keys.ps1'),'-ConfigPath',configPath,'-SelfTest'],{windowsHide:true,encoding:'utf8'});
  assert.ok(result.stdout.includes('GUI self-test passed'));
  const vaultPath=path.join(path.dirname(configPath),'vault.dpapi.json');
  const vault=await fs.readFile(vaultPath,'utf8');
  assert.equal(vault.includes('synthetic-test-credential'),false);
  const config=JSON.parse(await fs.readFile(configPath,'utf8'));
  assert.equal(config.profiles['isolated-test'].key_alias,'isolated-test');
  const decrypted=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',path.join(here,'Read-Vault.ps1'),'-VaultPath',vaultPath,'-KeyAlias','isolated-test'],{windowsHide:true,encoding:'utf8'});
  assert.equal(JSON.parse(decrypted.stdout).key,'synthetic-test-credential');
});
test.after(async()=>{
  assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('rolldek-test-'));
  await fs.rm(temporary,{recursive:true,force:true});
});
