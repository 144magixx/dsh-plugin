// Usage: PROMPT_FILE=... IMAGE_OUTPUT=... IMAGE_SIZE=1536x1024 node generate.mjs
// Reads the codex-relay provider from the DSH profile; the key is only read in-process.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const profile = process.env.DSH_PROFILE_DIR || path.join(dshHome, 'profiles', 'desktop');
const require = createRequire(path.join(profile, 'package.json'));
const { parse } = require('yaml');
const config = parse(await fs.readFile(path.join(profile, 'cordis.patch.yml'), 'utf8'));
const provider = config.find(x => x.id === 'llm-pi-ai')?.config?.providers?.['codex-relay'];
if (!provider?.baseURL || !provider.apiKeyEnv) throw new Error('未找到 codex-relay 地址或凭据引用');
let store = {};
try { store = parse(await fs.readFile(path.join(dshHome, '.credentials.yaml'), 'utf8')) || {}; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const key = store.refs?.[provider.apiKeyEnv] || process.env[provider.apiKeyEnv];
if (!key) throw new Error('未找到生图凭据');

const promptFile = path.resolve(process.env.PROMPT_FILE || '');
const output = path.resolve(process.env.IMAGE_OUTPUT || '');
const size = process.env.IMAGE_SIZE || '1536x1024';
if (!process.env.PROMPT_FILE || !process.env.IMAGE_OUTPUT) throw new Error('请设置 PROMPT_FILE 和 IMAGE_OUTPUT');
const prompt = await fs.readFile(promptFile, 'utf8');
try { await fs.access(output); throw new Error('输出文件已存在，请换一个路径'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const body = { model: 'gpt-image-2.5-sunburst', quality: 'high', prompt, n: 1, size, output_format: 'png' };
const response = await fetch(`${provider.baseURL.replace(/\/$/, '')}/images/generations`, {
  method: 'POST',
  headers: { ...provider.headers, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(240000)
});
const data = await response.json();
if (!response.ok) {
  const detail = String(data.error?.message || '生图请求失败').split(key).join('[REDACTED]').slice(0, 1000);
  throw new Error(`HTTP ${response.status}: ${detail}`);
}
const encoded = data.data?.[0]?.b64_json;
if (!encoded) throw new Error('响应未含 b64_json；检查是否返回 data[0].url，按约定单独下载');
const bytes = Buffer.from(encoded, 'base64');
if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('返回内容不是有效 PNG 文件头');
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, bytes, { flag: 'wx' });
const meta = {
  model: body.model, quality: body.quality, size, n: 1, output_format: 'png',
  promptFile, imagePath: output, bytes: bytes.length,
  requestId: response.headers.get('x-request-id'), createdAt: new Date().toISOString()
};
await fs.writeFile(output.replace(/\.png$/, '.json'), JSON.stringify(meta, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(meta));
