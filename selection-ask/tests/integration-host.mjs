import '../scripts/offline-test-guard.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runtimeImport, installRuntimeResolution } from '../scripts/test-runtime.mjs';
import { workspace } from '../scripts/extract-test-runtime.mjs';

installRuntimeResolution();
const { Context } = await runtimeImport('@deepseek-ai/cordis');
const llmModule = await runtimeImport('@deepseek-ai/dsh-llm');

/** In-process model: no network. `onRequest` can hold an open turn for interaction tests. */
export class OfflineAdapter extends llmModule.LlmAdapter {
  requests = [];
  reply = 'Offline fake answer.';
  async listModels(provider) { return Promise.all(['source-model', 'global-model'].map(id => this.resolveModel(provider, id))); }
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, contextWindow: 100000, maxOutputTokens: 8192,
      reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } };
  }
  async *stream(options) {
    this.requests.push(options);
    await this.onRequest?.(options);
    yield { type: 'reasoning-delta', index: 0, text: 'thinking' };
    for (const part of this.reply.match(/.{1,6}/gs) ?? []) { yield { type: 'text-delta', index: 1, text: part }; await this.delay?.(); }
    yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 4 } };
    yield { type: 'finish', reason: 'stop' };
  }
}

export async function createIsolatedHost({ root, config = {}, plugin = true } = {}) {
  root ??= path.join(workspace, 'tests', '.integration-data', randomUUID());
  root = path.resolve(root);
  const allowedRoot = path.join(workspace, 'tests', '.integration-data') + path.sep;
  if (!root.startsWith(allowedRoot)) throw new Error(`Test persistence must be inside ${allowedRoot}`);
  const cwd = path.join(root, 'workspace');
  await fs.mkdir(cwd, { recursive: true });
  const ctx = new Context();
  const fibers = [];
  const adapter = new OfflineAdapter();
  const errors = [];
  ctx.logger.exporter({ export: record => { if (record.type === 'error') errors.push(record.args); } });
  async function mount(name, options = {}) {
    const mod = await runtimeImport('@deepseek-ai/' + name);
    const fiber = ctx.plugin(mod.default ?? mod, options);
    fibers.push(fiber);
    await fiber.await();
    if (fiber.state !== 2) throw new Error(`Could not mount ${name}: ${String(fiber.error ?? fiber._error)}; ${JSON.stringify(errors)}`);
    return fiber;
  }
  const routes = new Map();
  let pluginFiber;
  async function mountPlugin() {
    const mod = await import(`../lib/index.js?${randomUUID()}`);
    pluginFiber = ctx.plugin(mod, config);
    fibers.push(pluginFiber);
    await pluginFiber.await();
    if (pluginFiber.state !== 2) throw new Error(`Selection Ask did not activate: ${String(pluginFiber._error ?? pluginFiber.error)}`);
    return pluginFiber;
  }
  try {
    await mount('dsh-typert-registry');
    await mount('dsh-session');
    await mount('dsh-session-projection');
    await mount('dsh-session-persistence-jsonl', { root: path.join(root, 'sessions'), compression: 'none' });
    await mount('dsh-storage');
    await mount('dsh-storage-json', { root: path.join(root, 'storage') });
    await mount('dsh-storage-domain', { backend: 'json' });
    await mount('dsh-workspace');
    await mount('dsh-system-prompt', {});
    await mount('dsh-tools');
    await mount('dsh-tool-executor-native');
    await mount('dsh-llm');
    ctx.llm.registerAdapter(['offline-test'], adapter);
    await mount('dsh-agent');
    await mount('dsh-session-query');
    await mount('dsh-session-turn-outline');
    await mount('dsh-agent-default-model', { provider: 'offline-test', model: 'global-model', reasoningEffort: 'low' });
    await mount('dsh-user-approval', { policy: 'ask' });
    await mount('dsh-user-questions');
    await mount('dsh-sandbox-policy', { mode: 'workspace-write', workspaceRoot: cwd });
    ctx.provide('shell', { sandboxMode: 'workspace-write' });
    ctx.provide('fs', {});
    ctx.provide('remoteAccess', { allows: () => true });
    // Inert gateway double: no Remote transport is composed in these tests.
    ctx.provide('typertGateway', { getPendingRemoteEvents: () => [], registerRemoteEvents: () => () => {} });
    ctx.provide('fileUploads', { registerAgentResolver: () => () => {}, bindPrompt: () => ({ commit() {}, [Symbol.dispose]() {} }) });
    ctx.provide('attachments', { imageLimits: { maxImageBytes: 10000000, maxImagesPerMessage: 8, maxMessageImageBytes: 20000000, maxImagePixels: 20000000, maxImageDimension: 10000, mediaTypes: ['image/png', 'image/jpeg'] }, admitPromptContent: async content => content });
    await mount('dsh-permission-presets', { defaultPreset: 'workspace-write' });
    await mount('dsh-session-title', { fallbackMaxWords: 8, fallbackMaxBytes: 200, maxTitleBytes: 500 });
    await mount('dsh-agent-loop');
    await mount('dsh-api-session-controller', { nativeOpen: false });
    const workspaceEntity = await ctx.workspaceRegistry.create(cwd, 'Isolated integration workspace');
    ctx.provide('connection', { fetch: { register: route => { routes.set(route.path, route); return () => routes.delete(route.path); } } });
    if (plugin) await mountPlugin();
    const h = {
      ctx, root, cwd, adapter, errors, routes, workspace: workspaceEntity, llm: llmModule, mount, mountPlugin,
      get plugin() { return pluginFiber; },
      waitIdle(agentId, ms = 5000) {
        return new Promise((resolve, reject) => {
          const agent = ctx.agents.get(agentId);
          if (agent && agent.status !== 'running') return resolve();
          const timer = setTimeout(() => { off(); offError(); reject(new Error(`Agent ${agentId} did not become idle in ${ms}ms`)); }, ms);
          const off = ctx.on('agent/status', ({ agent: target, status }) => { if (target.id === agentId && status !== 'running') { clearTimeout(timer); off(); offError(); resolve(); } });
          const offError = ctx.on('agent/error', ({ agent: target, error }) => { if (target.id === agentId) { clearTimeout(timer); off(); offError(); reject(error); } });
        });
      },
      async turn(agent, text) {
        const done = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { off(); offError(); reject(new Error('Offline turn exceeded 5 seconds')); }, 5000);
          const off = ctx.on('agent/status', ({ agent: target, status }) => { if (target.id === agent.id && status === 'idle') { clearTimeout(timer); off(); offError(); resolve(); } });
          const offError = ctx.on('agent/error', ({ agent: target, error }) => { if (target.id === agent.id) { clearTimeout(timer); off(); offError(); reject(error); } });
        });
        agent.followup(llmModule.createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
        await done;
        await ctx.sessions.flush(agent.session);
      },
      async post(operation, args, options = {}) {
        const route = routes.get(`/api/selection-ask/${operation}`);
        if (!route) throw new Error(`Route ${operation} is not registered`);
        const response = await route.fetch(new Request('http://offline.invalid', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args), signal: options.signal }));
        const body = await response.json();
        return { status: response.status, body };
      },
      async close() {
        for (const fiber of fibers.toReversed()) await Promise.resolve(fiber.dispose()).catch(() => {});
        await ctx.fiber.dispose();
      },
    };
    return h;
  } catch (error) {
    for (const fiber of fibers.toReversed()) await Promise.resolve(fiber.dispose()).catch(() => {});
    throw error;
  }
}

/** A source conversation with completed turns and an explicit current model. */
export async function createSource(h, prompts = ['Explain the limiter design.', 'Secret later turn ZEBRA-42.']) {
  const { sessionId } = await h.ctx.sessionController.create({ cwd: h.cwd });
  const agent = h.ctx.agents.get(sessionId);
  await h.workspace.attachSession(sessionId);
  agent.model.select({ provider: 'offline-test', model: 'source-model', reasoningEffort: 'high' });
  for (const text of prompts) await h.turn(agent, text);
  await h.ctx.sessions.flush(agent.session);
  return agent;
}
