#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import {imageDimensions} from './image-dimensions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const execFileAsync = promisify(execFile);
const jsonFile = async p => JSON.parse((await fs.readFile(p, 'utf8')).replace(/^\uFEFF/, ''));
export const catalog = (await jsonFile(path.join(root, 'assets', 'catalog.json'))).models;
export const defaultConfigPath = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'rolldek', 'config.json');
const mimeExtensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
export const fixedSizes = {
  '3:1':['1536x512','3072x1024','3840x1280'], '21:9':['1344x576','2688x1152','3840x1648'],
  '16:9':['1280x720','2048x1152','3840x2160'], '3:2':['1152x768','2304x1536','3520x2352'],
  '4:3':['1024x768','2048x1536','3312x2480'], '1:1':['1024x1024','2048x2048','2880x2880'],
  '3:4':['768x1024','1536x2048','2480x3312'], '2:3':['768x1152','1536x2304','2352x3520'],
  '9:16':['720x1280','1152x2048','2160x3840'], '1:3':['512x1536','1024x3072','1280x3840']
};
const commonRatios = ['1:1','16:9','9:16','4:3','3:4','3:2','2:3','5:4','4:5','21:9'];
const seedreamRatios = ['auto',...commonRatios,'2:1','1:2','3:1','1:3','9:21'];
const requestFields = new Set(['profile','prompt','count','size','aspect_ratio','resolution','quality','complexity','thinking_level','references','image_references','mask','mask_reference','output_format','background','input_fidelity','output_compression','moderation','user','output_dir','timeout_seconds']);
const advancedFields = ['output_format','background','input_fidelity','output_compression','moderation','user'];
function requireTrue(condition, message) { if (!condition) throw new Error(message); }
function choice(value, values, label) { requireTrue(values.includes(value), `${label} 只能是 ${values.join(' / ')}`); return value; }
function httpsUrl(value) {
  const u = new URL(value);
  requireTrue(u.protocol === 'https:' && !u.username && !u.password, '图片链接必须为不含凭据的 HTTPS 地址');
  return u.toString();
}
function apiBase(value) {
  const u = new URL(value || 'https://rolldek.com');
  requireTrue(u.protocol === 'https:' && ['rolldek.com','www.rolldek.com'].includes(u.hostname) && !u.port && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash, 'API 地址必须为 https://rolldek.com 或 https://www.rolldek.com');
  return u.origin;
}
export function detectMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') return 'image/webp';
  throw new Error('文件不是可识别的 PNG / JPEG / WebP 图片');
}
export function decodeBase64(value) {
  requireTrue(typeof value === 'string' && value.length > 0, '图片 Base64 数据为空');
  const cleaned = value.replace(/\s/g, '');
  requireTrue(/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned) && cleaned.length % 4 !== 1, '图片 Base64 格式无效');
  const bytes = Buffer.from(cleaned, 'base64');
  requireTrue(bytes.toString('base64').replace(/=+$/, '') === cleaned.replace(/=+$/, ''), '图片 Base64 格式无效');
  return bytes;
}
export async function readLocalImage(p) {
  requireTrue(typeof p === 'string' && path.isAbsolute(p), '参考图与蒙版必须使用本地绝对路径');
  const bytes = await fs.readFile(p);
  return {bytes, mime: detectMime(bytes), name:path.basename(p)};
}
async function seedreamReference(value, readImage) {
  requireTrue(typeof value === 'string', 'Seedream 参考图必须为路径或图片地址');
  if (value.startsWith('https://')) return httpsUrl(value);
  if (value.startsWith('data:')) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.*)$/s.exec(value);
    requireTrue(match, '参考图 Data URL 格式无效');
    const bytes = decodeBase64(match[2]);
    requireTrue(detectMime(bytes) === match[1], '参考图 MIME 类型与实际图片不符');
    return value;
  }
  const image = await readImage(value);
  return `data:${image.mime};base64,${image.bytes.toString('base64')}`;
}
function rejectPresent(q, fields, model) {
  for (const f of fields) requireTrue(q[f] === undefined, `${model} 未文档化支持参数 ${f}，请去掉此字段或选择对应模型`);
}
function validateImageReference(ref) {
  requireTrue(ref && typeof ref === 'object' && !Array.isArray(ref), 'JSON 图片引用必须是对象');
  const keys = Object.keys(ref);
  requireTrue(keys.length === 1 && ['image_url','file_id'].includes(keys[0]) && typeof ref[keys[0]] === 'string' && ref[keys[0]].length, '图片引用必须只含 image_url 或 file_id');
  if (ref.image_url?.startsWith('data:')) {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,(.*)$/s.exec(ref.image_url);
    requireTrue(m && detectMime(decodeBase64(m[2])) === m[1], '图片 Data URL 格式无效');
  } else if (ref.image_url) httpsUrl(ref.image_url);
  return {...ref};
}
function officialSize(value) {
  if (value === 'auto') return value;
  const match = /^(\d+)x(\d+)$/.exec(value);
  requireTrue(match, '官渠 size 必须为 auto 或 WIDTHxHEIGHT');
  const [w,h] = match.slice(1).map(Number);
  requireTrue(w > 0 && h > 0 && w % 16 === 0 && h % 16 === 0 && w/h >= 1/3 && w/h <= 3 && Math.max(w,h) <= 3840 && w*h <= 3840*2160, '官渠尺寸需满足16倍数、1:3～3:1比例及最大分辨率规则');
  return value;
}
function gpt26Size(q) {
  if (q.size !== undefined) {
    if (q.size === 'auto') return q.size;
    const match = /^(\d+)x(\d+)$/.exec(q.size);
    const [w,h] = match ? match.slice(1).map(Number) : [];
    requireTrue(Number.isSafeInteger(w) && Number.isSafeInteger(h) && w>0 && h>0 && w%16===0 && h%16===0 && w/h>=1/3 && w/h<=3,'GPT2.6 尺寸须为16倍数，比例须在1:3～3:1之间');
    requireTrue(q.resolution === undefined && (!q.aspect_ratio || q.aspect_ratio === 'auto'),'GPT2.6 size 与比例、分辨率不能同时指定');
    return q.size;
  }
  const level = choice(String(q.resolution ?? '1K').toUpperCase(),['1K','2K','4K'],'GPT2.6分辨率');
  const match = /^(\d+):(\d+)$/.exec(q.aspect_ratio && q.aspect_ratio !== 'auto' ? q.aspect_ratio : '1:1');
  let [w,h] = match ? match.slice(1).map(Number) : [];
  requireTrue(Number.isSafeInteger(w) && Number.isSafeInteger(h) && w>0 && h>0 && w/h>=1/3 && w/h<=3,'GPT2.6 比例须在1:3～3:1之间');
  const gcd = (a,b) => b ? gcd(b,a%b) : a;
  const divisor = gcd(w,h);w/=divisor;h/=divisor;
  const step = Math.floor({ '1K':1024,'2K':2048,'4K':4096 }[level]/(16*Math.max(w,h)));
  requireTrue(step>=1,'GPT2.6 比例精度过高，请直接指定16倍数的像素尺寸');
  return `${w*16*step}x${h*16*step}`;
}

export async function buildPlan(request, profile, { readImage = readLocalImage } = {}) {
  requireTrue(request && typeof request === 'object' && !Array.isArray(request), '请求必须是 JSON 对象');
  for (const key of Object.keys(request)) requireTrue(requestFields.has(key), `未知请求字段 ${key}；张数用 count，参考图用 references`);
  const q = {...(profile.defaults || {}), ...request};
  for (const key of Object.keys(q)) requireTrue(requestFields.has(key), `未知配置默认字段 ${key}`);
  const model = catalog.find(x => x.id === profile.model);
  requireTrue(model?.documented, `${profile.model} 尚无已核查的生图接口契约；请先查阅 RollDek 官方文档并更新适配器`);
  // Explicit dimensions override a stored resolution; a new ratio overrides a
  // stored size. Seedream's size is a ratio and stays independent of resolution.
  if (request.size !== undefined) {
    if (request.aspect_ratio === undefined) delete q.aspect_ratio;
    if (model.family !== 'seedream' && request.resolution === undefined) delete q.resolution;
  } else if (request.aspect_ratio !== undefined || (model.family !== 'seedream' && request.resolution !== undefined)) {
    delete q.size;
  }
  if (model.family !== 'gemini-banana21') rejectPresent(q, ['thinking_level'], model.id);
  if (model.family !== 'gpt26') rejectPresent(q, ['complexity'], model.id);
  requireTrue(typeof q.prompt === 'string' && q.prompt.trim().length, 'prompt 必须为非空文本');
  const count = q.count ?? 1;
  requireTrue(Number.isInteger(count) && count >= 1 && count <= 10, 'count 必须是1～10的整数');
  const references = q.references ?? [];
  requireTrue(Array.isArray(references), 'references 必须是数组');
  const imageReferences = q.image_references ?? [];
  requireTrue(Array.isArray(imageReferences), 'image_references 必须是数组');
  requireTrue(!(references.length && imageReferences.length), 'references 与 image_references 不能同时使用');
  requireTrue(!(q.mask && q.mask_reference), 'mask 与 mask_reference 不能同时使用');
  const hasReferences = references.length > 0 || imageReferences.length > 0;
  requireTrue(!(q.mask || q.mask_reference) || hasReferences, '蒙版必须配合参考图使用');
  const warnings = [];
  const result = {model:model.id, family:model.family, method:'POST', auth:'bearer', encoding:'json', path:'/v1/images/generations', repetitions:1, body:{model:model.id,prompt:q.prompt}, files:[], warnings, expected_count:count};
  const b = result.body;
  const imageCache = new Map();
  const loadImage = async p => {
    if (!imageCache.has(p)) imageCache.set(p,readImage(p));
    return imageCache.get(p);
  };
  const presetSize = async (level, mode) => {
    let shape;
    if (q.aspect_ratio && q.aspect_ratio !== 'auto') {
      const match = /^(\d+):(\d+)$/.exec(q.aspect_ratio);
      requireTrue(match && Number(match[1])>0 && Number(match[2])>0,'比例必须为正整数 WIDTH:HEIGHT');
      shape = {width:Number(match[1]),height:Number(match[2])};
    } else if (references.length) {
      shape = imageDimensions((await loadImage(references[0])).bytes);
    } else {
      requireTrue(!imageReferences.length,'JSON 参考图使用默认分辨率时，请在本次请求中指定 aspect_ratio 或 size');
      shape = {width:1,height:1};
    }
    requireTrue(shape.width>0 && shape.height>0,'参考图尺寸无效');
    const ratio = shape.width/shape.height;
    const ratios = Object.keys(fixedSizes);
    const nearest = ratios.reduce((best,r)=>Math.abs(Math.log(ratio/(r.split(':')[0]/r.split(':')[1]))) < Math.abs(Math.log(ratio/(best.split(':')[0]/best.split(':')[1]))) ? r : best);
    const nearestValue = nearest.split(':')[0]/nearest.split(':')[1];
    if (mode === 'fixed' || Math.abs(ratio/nearestValue-1) < 0.001) {
      if (mode === 'fixed' && Math.abs(ratio/nearestValue-1) >= 0.001) {
        requireTrue(!q.aspect_ratio || q.aspect_ratio === 'auto','非官渠 GPT2.5 比例须使用固定尺寸表');
        warnings.push(`参考图按该渠道支持的 ${nearest} 比例输出`);
      }
      return fixedSizes[nearest][['1K','2K','4K'].indexOf(level)];
    }
    requireTrue(ratio>=1/3 && ratio<=3,'官渠比例须在 1:3～3:1 之间');
    const edge = { '1K':1024, '2K':2048, '4K':3840 }[level];
    const scale = Math.min(edge/Math.max(shape.width,shape.height),Math.sqrt(3840*2160/(shape.width*shape.height)));
    let w = Math.max(16,Math.floor(shape.width*scale/16)*16);
    let h = Math.max(16,Math.floor(shape.height*scale/16)*16);
    if (w/h<1/3) w = Math.ceil(h/3/16)*16;
    if (w/h>3) h = Math.ceil(w/3/16)*16;
    return `${w}x${h}`;
  };

  if (model.family === 'gpt26') {
    requireTrue(!hasReferences, 'RollDek GPT2.6 S 当前公开能力为文生图；参考图编辑需要先核查该渠道的编辑契约');
    requireTrue(q.prompt.length<=32000,'GPT2.6 prompt 最长32000字符');
    rejectPresent(q, [...advancedFields,'mask','mask_reference'], model.id);
    if (q.size !== undefined || q.resolution !== undefined || (q.aspect_ratio && q.aspect_ratio !== 'auto')) b.size = gpt26Size(q);
    if (q.quality !== undefined) b.quality = choice(q.quality,['auto','low','medium','high','xhigh','max'],'GPT2.6质量');
    if (q.complexity !== undefined) b.complexity = choice(q.complexity,['low','medium','high'],'GPT2.6复杂度');
    result.repetitions = count;
    warnings.push('GPT2.6 的 size、quality、complexity 按官方 Images 协议传递；RollDek 渠道尚未进行收费实测，每张图片独立提交。');
  } else if (model.family === 'seedream') {
    rejectPresent(q, ['quality',...advancedFields,'image_references','mask','mask_reference'], model.id);
    requireTrue(count <= 4, 'Seedream 单次 count 最多4');
    requireTrue(references.length <= 10, 'Seedream 参考图最多10张');
    if (references.length > 4) warnings.push('Seedream 文档建议参考图不超过4张');
    requireTrue(!(q.size && q.aspect_ratio && q.size !== q.aspect_ratio), 'Seedream size 与 aspect_ratio 必须一致');
    b.size = choice(q.size ?? q.aspect_ratio ?? 'auto', seedreamRatios, 'Seedream比例');
    b.resolution = choice(String(q.resolution ?? '1k').toLowerCase(), ['1k','2k'], 'Seedream分辨率');
    b.n = count;
    const refs = await Promise.all(references.map(x => seedreamReference(x, readImage)));
    if (refs.length === 1) b.image = refs[0];
    if (refs.length > 1) b.images = refs;
    if (profile.api_group && profile.api_group !== 'seedream') warnings.push('Seedream 密钥须属于控制台 seedream 分组');
  } else if (model.family.startsWith('gemini-')) {
    rejectPresent(q, ['size','quality',...advancedFields,'image_references','mask','mask_reference'], model.id);
    requireTrue(references.length <= 14, 'Gemini 参考图最多14张');
    result.path = `/v1beta/models/${encodeURIComponent(model.id)}:generateContent`;
    result.auth = 'google';
    result.repetitions = count;
    const imageSettings = {};
    if (q.aspect_ratio && q.aspect_ratio !== 'auto') imageSettings.aspectRatio = choice(q.aspect_ratio, ['gemini-flash','gemini-banana21'].includes(model.family) ? [...commonRatios,'8:1','4:1','1:4','1:8'] : commonRatios, 'Gemini比例');
    if (q.resolution) imageSettings.imageSize = choice(String(q.resolution).toUpperCase(), ['1K','2K','4K'], 'Gemini分辨率');
    const parts = [{text:q.prompt}];
    for (const p of references) { const im = await readImage(p); parts.push({inlineData:{mimeType:im.mime,data:im.bytes.toString('base64')}}); }
    result.body = {contents:[{role:'user',parts}],generationConfig:{responseModalities:['IMAGE']}};
    if (q.thinking_level !== undefined) result.body.generationConfig.thinkingConfig = {thinkingLevel:choice(q.thinking_level,['minimal','medium','high'],'Nano Banana 2.1思考等级')};
    if (Object.keys(imageSettings).length) result.body.generationConfig.responseFormat = {image:imageSettings};
  } else {
    requireTrue(references.length + imageReferences.length <= 16, 'GPT Images 参考图最多16张');
    if (hasReferences) result.path = '/v1/images/edits';
    if (model.family === 'gpt2') {
      rejectPresent(q, ['aspect_ratio','resolution',...advancedFields,'image_references','mask','mask_reference'], model.id);
      if (q.size !== undefined) {
        requireTrue(q.size === 'auto' || /^\d+x\d+$/.test(q.size), 'GPT2 size 必须为 auto 或 WIDTHxHEIGHT');
        b.size = q.size;
      }
      if (q.quality !== undefined) {
        if (model.id === 'gpt-image-2') { choice(q.quality,['medium'],'GPT2质量'); }
        else choice(q.quality,['medium','high'],'GPT2 high质量');
        b.quality = q.quality;
      }
      b.n = count;
      b.response_format = 'b64_json';
    } else {
      requireTrue(q.prompt.length <= 32000, 'GPT2.5 prompt 最长32000字符');
      const mode = model.family === 'gpt25-base' ? 'fixed' : profile.channel_mode;
      requireTrue(['fixed','official'].includes(mode), '请在图形窗口确认该 GPT2.5 密钥是非官渠固定尺寸还是官渠自定义尺寸');
      if (mode === 'fixed') {
        const level = choice(String(q.resolution ?? '1K').toUpperCase(), model.family === 'gpt25-base' ? ['1K'] : ['1K','2K','4K'], 'GPT2.5分辨率');
        let size = q.size;
        if (q.aspect_ratio || q.resolution || (!hasReferences && size === undefined)) {
          const mapped = await presetSize(level,mode);
          requireTrue(size === undefined || size === mapped, 'size 与所选比例、分辨率冲突');
          size = mapped;
        }
        if (size !== undefined) {
          const allowed = Object.values(fixedSizes).flatMap(a => model.family === 'gpt25-base' ? [a[0]] : a);
          requireTrue(allowed.includes(size), '非官渠 GPT2.5 只能使用文档固定尺寸表中的像素值');
          b.size = size;
        }
        result.repetitions = count;
      } else {
        let size = q.size;
        if (q.resolution !== undefined || (q.aspect_ratio && q.aspect_ratio !== 'auto')) {
          const level = choice(String(q.resolution ?? '1K').toUpperCase(),['1K','2K','4K'],'GPT2.5分辨率');
          const mapped = await presetSize(level,mode);
          requireTrue(size === undefined || size === mapped,'size 与所选比例、分辨率冲突');
          size = mapped;
        }
        if (size !== undefined) b.size = officialSize(size);
        b.n = count;
        if (size && size !== 'auto') { const [w,h] = size.split('x').map(Number); if (w*h > 2560*1440) warnings.push('官渠大于2560x1440属于实验分辨率'); }
      }
      if (model.family === 'gpt25-base') rejectPresent(q,['quality',...advancedFields,'image_references','mask','mask_reference'],model.id);
      else {
        if (q.quality !== undefined) b.quality = choice(q.quality,['low','medium','high','xhigh','max','auto'],'GPT2.5质量');
        for (const f of advancedFields) if (q[f] !== undefined) b[f] = q[f];
        if (b.output_format !== undefined) choice(b.output_format,['png','jpeg','webp'],'输出格式');
        if (b.background !== undefined) choice(b.background,['transparent','opaque','auto'],'背景');
        requireTrue(b.background !== 'transparent' || (b.output_format ?? 'png') !== 'jpeg', '透明背景须使用 PNG / WebP');
        if (b.input_fidelity !== undefined) { choice(b.input_fidelity,['high','low'],'input_fidelity'); requireTrue(hasReferences,'input_fidelity 只适用于编辑'); }
        if (b.output_compression !== undefined) {
          requireTrue(Number.isInteger(b.output_compression) && b.output_compression >= 0 && b.output_compression <= 100 && ['jpeg','webp'].includes(b.output_format), 'output_compression 必须为0～100整数且配合JPEG/WebP');
        }
        if (b.moderation !== undefined) choice(b.moderation,['auto','low'],'moderation');
        if (b.user !== undefined) requireTrue(typeof b.user === 'string','user 必须为字符串');
      }
    }
    if (imageReferences.length) {
      b.images = imageReferences.map(validateImageReference);
      requireTrue(!q.mask, 'JSON 编辑请使用 mask_reference');
      if (q.mask_reference) b.mask = validateImageReference(q.mask_reference);
    } else if (references.length) {
      requireTrue(!q.mask_reference, '本地文件编辑请使用 mask');
      result.encoding = 'multipart';
      for (const p of references) result.files.push({field:references.length === 1 ? 'image' : 'image[]', ...(await loadImage(p))});
      if (q.mask) result.files.push({field:'mask',...(await loadImage(q.mask))});
    }
  }
  return result;
}

export function extractImages(response, family) {
  const images = [];
  if (family.startsWith('gemini-')) {
    for (const c of response.candidates || []) for (const part of c.content?.parts || []) {
      if (part.thought || !part.inlineData?.data) continue;
      requireTrue(mimeExtensions[part.inlineData.mimeType], 'Gemini 返回不支持的图片 MIME 类型');
      const bytes = decodeBase64(part.inlineData.data);
      requireTrue(detectMime(bytes) === part.inlineData.mimeType, '生成图片 MIME 类型与内容不符');
      images.push({bytes,mime:part.inlineData.mimeType});
    }
  } else {
    for (const item of response.data || []) {
      if (item.b64_json) { const bytes = decodeBase64(item.b64_json); images.push({bytes,mime:detectMime(bytes)}); }
      else if (item.url) images.push({url:httpsUrl(item.url)});
    }
  }
  return images;
}
export async function ensureConfig(configPath = defaultConfigPath) {
  await fs.mkdir(path.dirname(configPath), {recursive:true});
  const sample = await fs.readFile(path.join(root,'assets','config.example.json'));
  try { await fs.writeFile(configPath,sample,{flag:'wx',mode:0o600}); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  return jsonFile(configPath);
}
export async function loadKey(profile, configPath) {
  if (profile.key_env) {
    const value = process.env[profile.key_env];
    requireTrue(value?.trim(), '配置中的密钥环境变量未设置');
    return value.trim();
  }
  requireTrue(process.platform === 'win32', '此配置使用 Windows DPAPI 密钥，请在原 Windows 账户运行');
  requireTrue(profile.key_alias, '配置缺少 key_alias，请打开图形配置窗口');
  try {
    const {stdout} = await execFileAsync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',path.join(here,'Read-Vault.ps1'),'-VaultPath',path.join(path.dirname(configPath),'vault.dpapi.json'),'-KeyAlias',profile.key_alias], {windowsHide:true,encoding:'utf8',maxBuffer:1024*1024});
    const value = JSON.parse(stdout.trim());
    requireTrue(value.key?.trim(), '密钥未设置');
    return value.key.trim();
  } catch { throw new Error('该配置没有可解密的密钥，请打开图形配置窗口并保存 API 密钥'); }
}
export function previewPlan(plan) {
  const body = JSON.parse(JSON.stringify(plan.body, (key,value) => {
    if (key === 'data' && typeof value === 'string') return `[base64 ${value.length} chars]`;
    if (typeof value === 'string' && value.startsWith('data:image/')) return `[data URL ${value.length} chars]`;
    return value;
  }));
  return {...plan,body,files:plan.files.map(x=>({field:x.field,name:x.name,mime:x.mime,bytes:x.bytes.length}))};
}
function sanitized(value, secret) {
  let s = String(value ?? '');
  if (secret) s = s.split(secret).join('[REDACTED]');
  return s.replace(/sk-[\w-]+/g,'[REDACTED]').replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').replace(/data:image\/[^\s"]+/g,'[IMAGE DATA]').slice(0,1200);
}
export async function windowsFetch(url, options = {}, {spawnImpl = spawn} = {}) {
  const headers = Object.fromEntries(new Headers(options.headers || {}).entries());
  let bodyBase64 = null;
  if (options.body !== undefined) {
    // Response serializes FormData with its boundary; do not handcraft multipart bodies.
    const serialized = new Response(options.body);
    if (!headers['content-type'] && serialized.headers.has('content-type')) headers['content-type'] = serialized.headers.get('content-type');
    bodyBase64 = Buffer.from(await serialized.arrayBuffer()).toString('base64');
  }
  const payload = JSON.stringify({url:String(url),method:options.method || 'GET',headers,body_base64:bodyBase64,allow_redirect:options.redirect === 'follow'});
  if (options.signal?.aborted) throw new Error('请求在提交前已取消');
  const stdout = await new Promise((resolve,reject)=>{
    const child = spawnImpl('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',path.join(here,'Http-Request.ps1')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const chunks = [];
    let size = 0;
    const abort = ()=>{child.kill();reject(new Error('请求超时或取消；可能已被服务端接收'));};
    options.signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',chunk=>{
      size += chunk.length;
      if (size > 256*1024*1024) { child.kill();reject(new Error('响应数据过大；请求未重发')); }
      else chunks.push(chunk);
    });
    // Drain stderr without forwarding it; the helper may handle confidential payloads.
    child.stderr.resume();
    child.stdin.on('error',()=>{});
    child.once('error',()=>{options.signal?.removeEventListener('abort',abort);reject(new Error('无法启动 Windows 网络客户端'));});
    child.once('close',code=>{
      options.signal?.removeEventListener('abort',abort);
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'));
      else reject(new Error('Windows 网络请求失败，请检查系统代理或网络连接'));
    });
    // Credentials cross a private pipe, never command-line arguments or temp files.
    child.stdin.end(payload);
  });
  let r;
  try { r = JSON.parse(stdout); } catch { throw new Error('Windows 网络客户端返回无效响应'); }
  const bytes = Buffer.from(r.body_base64,'base64');
  return new Response([204,205,304].includes(r.status) ? null : bytes,{status:r.status,headers:r.headers});
}
const defaultFetch = process.platform === 'win32' ? windowsFetch : fetch;
async function saveManifest(p, manifest) {
  const temp = `${p}.${randomUUID()}.tmp`;
  await fs.writeFile(temp,JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  await fs.rename(temp,p);
}
export async function generate(request, config, {configPath = defaultConfigPath, fetchImpl = defaultFetch, keyLoader = loadKey, dryRun = false} = {}) {
  const profileName = request.profile ?? config.default_profile;
  const profile = config.profiles?.[profileName];
  requireTrue(profile, '指定的配置不存在，请打开图形配置窗口');
  const base = apiBase(config.api_base);
  const plan = await buildPlan(request,profile);
  if (dryRun) return {profile:profileName,api_base:base,...previewPlan(plan)};
  const key = await keyLoader(profile,configPath);
  const timeout = request.timeout_seconds ?? 300;
  requireTrue(Number.isInteger(timeout) && timeout >= 10 && timeout <= 1800, 'timeout_seconds 必须为10～1800的整数');
  const parent = path.resolve(request.output_dir || 'rolldek-output');
  const outputDir = path.join(parent,new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
  await fs.mkdir(outputDir,{recursive:true});
  const manifestPath = path.join(outputDir,'manifest.json');
  const manifest = {profile:profileName,model:plan.model,api_group:profile.api_group || null,channel_mode:profile.channel_mode,status:'running',requested_images:plan.expected_count,attempted_requests:0,completed_requests:0,images:[],requests:[],warnings:plan.warnings};
  await saveManifest(manifestPath,manifest);
  try {
    for (let iteration=0; iteration<plan.repetitions; iteration++) {
      const headers = plan.auth === 'google' ? {'x-goog-api-key':key} : {Authorization:`Bearer ${key}`};
      let body;
      if (plan.encoding === 'multipart') {
        body = new FormData();
        for (const [name,value] of Object.entries(plan.body)) body.append(name,String(value));
        for (const file of plan.files) body.append(file.field,new Blob([file.bytes],{type:file.mime}),file.name);
      } else { headers['Content-Type'] = 'application/json'; body = JSON.stringify(plan.body); }
      manifest.attempted_requests++;
      await saveManifest(manifestPath,manifest);
      const resp = await fetchImpl(base+plan.path,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(timeout*1000)});
      const requestId = resp.headers.get('x-oneapi-request-id') || resp.headers.get('x-request-id');
      const entry = {index:iteration+1,http_status:resp.status,request_id:requestId};
      manifest.requests.push(entry);
      let data;
      try { data = await resp.json(); } catch { throw new Error(`HTTP ${resp.status} 返回非 JSON 响应，请核查对应模型接口`); }
      if (!resp.ok || data.error) throw new Error(`HTTP ${resp.status}; code=${sanitized(data.error?.code,key)}; request_id=${sanitized(requestId,key)}; ${sanitized(data.error?.message || '请求失败',key)}`);
      const images = extractImages(data,plan.family);
      if (!images.length) {
        const reasons = (data.candidates || []).map(c=>c.finishReason).filter(Boolean);
        throw new Error(`响应中没有生成图片; finishReason=${reasons.join(',')}; blockReason=${sanitized(data.promptFeedback?.blockReason,key)}`);
      }
      entry.output_urls = images.filter(im=>im.url).map(im=>im.url);
      await saveManifest(manifestPath,manifest);
      // Save each successful output before reporting a count mismatch. Never resubmit a POST.
      for (const im of images) {
        let bytes = im.bytes;
        if (im.url) {
          const download = await fetchImpl(im.url,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(timeout*1000)});
          requireTrue(download.ok,`生成图片下载失败 HTTP ${download.status}`);
          bytes = Buffer.from(await download.arrayBuffer());
        }
        const mime = detectMime(bytes);
        const filename = `image_${String(manifest.images.length+1).padStart(2,'0')}${mimeExtensions[mime]}`;
        const filePath = path.join(outputDir,filename);
        await fs.writeFile(filePath,bytes,{flag:'wx'});
        manifest.images.push({path:filePath,mime,bytes:bytes.length,request_index:iteration+1,...(im.url?{url:im.url}:{})});
        await saveManifest(manifestPath,manifest);
      }
      manifest.completed_requests++;
      const expected = plan.repetitions === 1 ? plan.expected_count : 1;
      requireTrue(images.length === expected, `本次请求返回${images.length}张而非预期${expected}张；已保存返回图片，停止后续请求`);
      await saveManifest(manifestPath,manifest);
    }
    manifest.status = 'completed';
    await saveManifest(manifestPath,manifest);
    return {...manifest,manifest:manifestPath};
  } catch (e) {
    manifest.status = 'failed';
    manifest.error = sanitized(e.message,key);
    await saveManifest(manifestPath,manifest);
    const failure = new Error(`${manifest.error}；已保存${manifest.images.length}张，未自动重发。清单：${manifestPath}`);
    failure.manifest = manifest;
    throw failure;
  }
}
async function list(config,configPath) {
  let aliases = [];
  try { aliases = Object.keys((await jsonFile(path.join(path.dirname(configPath),'vault.dpapi.json'))).keys || {}); } catch (e) { if (e.code !== 'ENOENT') throw new Error('密钥库格式无效，请打开图形配置窗口'); }
  return Object.entries(config.profiles || {}).map(([name,p])=>({profile:name,model:p.model,default:name===config.default_profile,api_group:p.api_group,channel_mode:p.channel_mode,defaults:p.defaults || {},key_configured:p.key_env?Boolean(process.env[p.key_env]):aliases.includes(p.key_alias),documented:catalog.find(x=>x.id===p.model)?.documented===true}));
}
async function discover() {
  const [sidebar,pricing] = await Promise.all([
    defaultFetch('https://www.rolldek.com/docs/_sidebar.md',{signal:AbortSignal.timeout(30000)}),
    defaultFetch('https://rolldek.com/api/pricing',{signal:AbortSignal.timeout(30000)})
  ]);
  requireTrue(sidebar.ok && pricing.ok,'公开文档或模型目录读取失败');
  const s = await sidebar.text(), p = await pricing.json();
  return {checked_at:new Date().toISOString(),documentation:s,image_related_models:(p.data || []).filter(x=>/gpt-image|gemini.*image|nano.*banana|seedream/i.test(x.model_name)).map(x=>({model:x.model_name,groups:x.enable_groups,endpoint_types:x.supported_endpoint_types,known_contract:catalog.find(c=>c.id===x.model_name)?.documented===true})),note:'endpoint_types 不能代替具体接口契约；WAN image 型号为图生视频'};
}
async function main() {
  const args = process.argv.slice(2);
  const command = args.shift() || 'help';
  const opts = {};
  while (args.length) {
    const k = args.shift();
    requireTrue(['--config','--request','--dry-run'].includes(k),`未知参数 ${k}`);
    opts[k] = k === '--dry-run' ? true : args.shift();
    requireTrue(opts[k] !== undefined,`${k} 缺少值`);
  }
  const configPath = path.resolve(opts['--config'] || defaultConfigPath);
  if (command === 'help') return console.log('RollDek Basic: list | configure | discover | generate --request ABSOLUTE_JSON_PATH [--dry-run] [--config ABSOLUTE_CONFIG_PATH]');
  if (command === 'discover') return console.log(JSON.stringify(await discover(),null,2));
  const config = await ensureConfig(configPath);
  if (command === 'configure') {
    requireTrue(process.platform === 'win32','图形密钥配置当前支持 Windows');
    const {stdout} = await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',path.join(here,'Open-Configuration.ps1'),'-ConfigPath',configPath],{windowsHide:true,encoding:'utf8',timeout:15000});
    const opened = JSON.parse(stdout.trim());
    requireTrue(opened.window_visible === true,'配置窗口未显示');
    return console.log(`模型与密钥管理窗口已显示（进程 ${opened.process_id}）；逐项保存后关闭即可。`);
  }
  if (command === 'list') return console.log(JSON.stringify(await list(config,configPath),null,2));
  if (command === 'generate') {
    requireTrue(opts['--request'] && path.isAbsolute(opts['--request']), '请提供 --request 请求JSON文件的绝对路径');
    return console.log(JSON.stringify(await generate(await jsonFile(opts['--request']),config,{configPath,dryRun:Boolean(opts['--dry-run'])}),null,2));
  }
  throw new Error(`未知命令 ${command}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e=>{console.error(sanitized(e.message));process.exitCode=1;});
}
