/* Browser-only fixture using the installed native bubble, Copy and keyed renderer. */
(async () => {
  const shared = window.__shared;
  const preview = new URLSearchParams(location.search).get('preview') === 'zh';
  const React = shared.react;
  const h = React.createElement;
  const require = id => { if (!(id in shared)) throw new Error('Missing shared module ' + id); return shared[id]; };
  const native = window.__registrations['@deepseek-ai/dsh-client-ui-chat'].factory(require);
  const renderer = window.__registrations['@deepseek-ai/dsh-client-ui-renderer'].factory(require);
  const plugin = window.__registrations['dsh-side-branch'].factory(require);
  const { Context } = shared['@deepseek-ai/cordis'];
  const ctx = new Context();
  const fiber = ctx.plugin(renderer); await fiber.await();
  if (fiber.state !== 2) throw new Error('Renderer mount failed: ' + fiber._error);
  const stable = value => ({ getSnapshot: () => value, subscribe: () => () => {} });
  const clock = Date.now();
  const turn = { turn: 1, end: { seq: 10 } };
  const node = (id, kind, seq, source = 'user') => ({ id, key: id, kind, anchorSeq: seq, location: { kind: seq === 1 ? 'turn' : 'step', turn }, data: { id, seq, content: [{ type: 'text', text: preview ? '请帮我检查这段实现：保留原生提问气泡和复制功能，\n在复制按钮旁边分别加上「编辑」和「分叉」操作。' : 'Native text ' + id }], time: clock, source: { kind: source } } });
  const nodes = [node('prompt-1', 'user', 1), node('later-prompt', 'user', 4), node('steering-1', 'steering', 5), node('context-1', 'context', 6, 'session-reference')].filter((_, index) => !preview || index === 0);
  const closing = [{ id: 'answer-1', key: 'answer-1', kind: 'assistant-step', anchorSeq: 8 }, { id: 'tail-1', key: 'tail-1', kind: 'turn-tail', anchorSeq: 10, data: { seq: 10, closing: { finalNode: { messageId: 'answer-1', seq: 8 } } } }];
  const indexed = [...nodes, ...closing];
  const snapshot = { timeline: { turnOrder: [1], turns: new Map([[1, turn]]) }, locations: { getTurn: () => indexed.map(n => n.key) }, nodes: new Map(indexed.map(n => [n.key, n])) };
  const clipboard = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => clipboard.push(text) } });
  const locale = { ...stable({ revision: 0 }), bind: () => key => ({ copy: 'Copy', copied: 'Copied', 'time.today': 'Today' }[key] ?? key) };
  ctx.slots.installLocale(locale);
  ctx.slots.installScope('session', { current: stable({ key: undefined, hooks: {}, keyedHooks: {}, props: {} }) });
  ctx.provide('sidebarRight', { mounted: stable('main-session') });
  ctx.slots.provideRoot({ hooks: { chat: stable(snapshot) }, props: { sessionId: 'branch-session', useAccess: () => true } });
  const rootRegistration = ctx.slots.register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'root' } } }, ({ renderSlot }) => h('main', null, nodes.map(node => h('section', { key: node.id, 'data-fixture-node': node.id }, renderSlot('conversation.chat.node', { node, loadImage: () => '' }, { key: node.kind, entryKey: node.kind })))));
  ctx.slots.registerFactory({ name: 'conversation.chat.user.content', scope: 'root', locale: 'chat', children: { 'conversation.chat.user.images': { kind: 'single', scope: 'root' } } }, native.__UserContent);
  ctx.slots.registerFactory({ name: 'conversation.user.text', scope: 'root' }, ({ text }) => h('span', { 'data-fixture-text': true }, text));
  let removeNative = ctx.slots.register({ name: 'conversation.chat.node', key: 'user', locale: 'chat' }, native.__UserMessageNodeView);
  ctx.slots.register({ name: 'conversation.chat.node', key: 'steering', locale: 'chat' }, native.__UserMessageNodeView);
  ctx.slots.register({ name: 'conversation.chat.node', key: 'context' }, () => h('div', null, 'Context unchanged'));
  const requests = []; const opened = []; const mainOpened = []; const prompts = []; const draftInitializations = []; const retained = []; let deferred;
  const bindings = new Map();
  const bindingFor = id => {
    if (!bindings.has(id)) bindings.set(id, {
      sessionId: id,
      ctx: {},
      session: { sessionId: id, prompt: async (content, mode, signal, requestId) => {
        prompts.push({ sessionId: id, content, mode, requestId });
        return { ok: true, value: { accepted: true } };
      } },
    });
    return bindings.get(id);
  };
  ctx.provide('sessions', {
    retain: (id, options) => {
      retained.push({ id, source: options?.source });
      const binding = bindingFor(id);
      return { sessionId: id, binding, session: binding.session, ctx: binding.ctx, ready: Promise.resolve(), release: () => {} };
    },
    binding: id => bindingFor(id),
    refresh: async () => {},
  });
  ctx.provide('conversation', { input: {
    requestDraftInitialization: (binding, options) => {
      draftInitializations.push({ sessionId: binding.sessionId, ...options });
      return 'applied';
    },
    for: scope => {
      const binding = [...bindings.values()].find(item => item.ctx === scope);
      return { actions: { setDraft: text => draftInitializations.push({ sessionId: binding?.sessionId, prompt: text }), submit: () => {} } };
    },
  } });
  const runtime = plugin.createRuntime({ storage: undefined, makeId: () => 'stable-request-id', api: async (operation, body) => {
    requests.push({ operation, ...body });
    return new Promise((resolve, reject) => { deferred = { resolve, reject }; });
  } });
  const t = (key, params = {}) => String((preview ? plugin.ZH : plugin.EN)[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
  const props = { runtime, t, nativeAvailable: true, sidebarSessionId: () => 'main-session', openBranch: branch => { opened.push(branch); return true; }, openMain: sessionId => { mainOpened.push(sessionId); return true; } };
  let removePlugin;
  const install = () => { removePlugin = plugin.registerUserActions(ctx, props); };
  install();
  const root = shared['react-dom/client'].createRoot(document.getElementById('root'));
  root.render(ctx.slots.renderSlot('root', {}));
  window.__userActions = {
    requests, opened, mainOpened, prompts, draftInitializations, retained, clipboard, t,
    reject: () => deferred.reject(new Error('Fixture temporary failure')),
    resolve: () => { const request = requests.at(-1); return deferred.resolve({ branch: { ready: true, sessionId: request.intent === 'revise' ? 'edited-child' : 'fork-child', sourceSessionId: 'branch-session', mode: request.mode, intent: request.intent, turn: 1, draftPrompt: 'Native text prompt-1' } }); },
    addAttachment: () => { nodes[0].data.content.push({ type: 'file', attachment: { attachmentId: 'fixture-file', name: 'notes.txt', bytes: 12 } }); },
    uninstall: () => { removePlugin?.(); removePlugin = undefined; },
    install,
    replaceNative: () => { removeNative(); removeNative = ctx.slots.register({ name: 'conversation.chat.node', key: 'user', locale: 'chat' }, React.memo(native.__UserMessageNodeView.type)); },
    dispose: async () => { removePlugin?.(); root.unmount(); rootRegistration(); runtime.dispose(); await fiber.dispose(); await ctx.fiber.dispose(); },
  };
})().catch(error => { window.__fixtureError = String(error.stack || error); console.error(error); });
