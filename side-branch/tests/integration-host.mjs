import '../scripts/offline-test-guard.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runtimeImport, installRuntimeResolution } from '../scripts/test-runtime.mjs';
import { workspace } from '../scripts/extract-test-runtime.mjs';

installRuntimeResolution();
const { Context } = await runtimeImport('@deepseek-ai/cordis');
const llmModule = await runtimeImport('@deepseek-ai/dsh-llm');

export class OfflineAdapter extends llmModule.LlmAdapter {
  requests = [];
  async listModels(provider) { return Promise.all(['source-model', 'global-model', 'alternate-model'].map(id => this.resolveModel(provider, id))); }
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, contextWindow: 100000, maxOutputTokens: 8192,
      reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } };
  }
  async *stream(options) {
    this.requests.push(options);
    await this.onRequest?.(options);
    yield { type: 'text-delta', index: 0, text: 'Offline fake answer.' };
    yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 4 } };
    yield { type: 'finish', reason: 'stop' };
  }
}

export async function createIsolatedHost({ root, reopen = false } = {}) {
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
  async function mount(name, config = {}) {
    const mod = await runtimeImport('@deepseek-ai/' + name);
    const fiber = ctx.plugin(mod.default ?? mod, config);
    fibers.push(fiber);
    await fiber.await();
    if (fiber.state !== 2) throw new Error(`Could not mount ${name}: ${String(fiber.error ?? fiber._error)}; ${JSON.stringify(errors)}`);
    return fiber;
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
    await mount('dsh-llm');
    ctx.llm.registerAdapter(['offline-test'], adapter);
    await mount('dsh-agent');
    await mount('dsh-session-query');
    await mount('dsh-session-turn-outline');
    await mount('dsh-agent-default-model', { provider: 'offline-test', model: 'global-model', reasoningEffort: 'low' });
    await mount('dsh-user-approval', { policy: 'ask' });
    await mount('dsh-sandbox-policy', { mode: 'workspace-write', workspaceRoot: cwd });
    // These host capabilities are inert test doubles. No shell, filesystem execution,
    // upload transport, remote gateway, or socket service is composed.
    ctx.provide('shell', { sandboxMode: 'workspace-write' });
    ctx.provide('fs', {});
    ctx.provide('remoteAccess', { allows: () => true });
    ctx.provide('fileUploads', { registerAgentResolver: () => () => {}, bindPrompt: () => ({ commit() {}, [Symbol.dispose]() {} }) });
    ctx.provide('attachments', { imageLimits: { maxImageBytes: 10000000, maxImagesPerMessage: 8, maxMessageImageBytes: 20000000, maxImagePixels: 20000000, maxImageDimension: 10000, mediaTypes: ['image/png', 'image/jpeg'] }, admitPromptContent: async content => content });
    await mount('dsh-permission-presets', { defaultPreset: 'workspace-write' });
    await mount('dsh-session-title', { fallbackMaxWords: 8, fallbackMaxBytes: 200, maxTitleBytes: 500 });
    await mount('dsh-agent-loop');
    await mount('dsh-api-session-controller', { nativeOpen: false });
    const workspaceEntity = await ctx.workspaceRegistry.create(cwd, 'Isolated integration workspace');
    const routes = new Map();
    ctx.provide('connection', { fetch: { register: route => { routes.set(route.path, route); return () => routes.delete(route.path); } } });
    const plugin = await import('../lib/index.js');
    const pluginFiber = ctx.plugin(plugin); fibers.push(pluginFiber); await pluginFiber.await();
    if (pluginFiber.state !== 2) throw new Error(`Side Branch did not activate: ${String(pluginFiber._error)}`);
    return {
      ctx, root, cwd, adapter, errors, routes, workspace: workspaceEntity, llm: llmModule, mount,
      async turn(agent, text) {
        const completion = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { offStatus(); offError(); reject(new Error('Offline turn exceeded 5 seconds')); }, 5000);
          const offStatus = ctx.on('agent/status', ({ agent: target, status }) => { if (target.id === agent.id && status === 'idle') { clearTimeout(timer); offStatus(); offError(); resolve(); } });
          const offError = ctx.on('agent/error', ({ agent: target, error }) => { if (target.id === agent.id) { clearTimeout(timer); offStatus(); offError(); reject(error); } });
        });
        agent.followup(llmModule.createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
        await completion;
        await ctx.sessions.flush(agent.session);
      },
      async close() {
        for (const fiber of fibers.toReversed()) await fiber.dispose();
        await ctx.fiber.dispose();
      },
    };
  } catch (error) {
    for (const fiber of fibers.toReversed()) await fiber.dispose().catch(() => {});
    throw error;
  }
}
