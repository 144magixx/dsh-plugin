import React from 'react';
import { Diagram } from './diagram.jsx';
import { splitDiagrams, referenceDefinitions } from './parse.mjs';
import en from '../locale/en.json';
import zh from '../locale/zh.json';

const h = React.createElement;
const SLOT = 'conversation.chat.node';
const ID = 'dsh-mermaid-diagrams.assistant@0.2.0';
const NS = 'dsh-mermaid-diagrams';
const ALIASES = {
  'conversation.chat.reasoning.body': 'dsh-mermaid-diagrams.reasoning-body',
  'conversation.chat.message.images': 'dsh-mermaid-diagrams.message-images'
};

export function partitionBlocks(blocks) {
  const parts = [];
  let pending = [];
  const flush = () => {
    if (pending.length) parts.push({ kind: 'native', blocks: pending, key: `native-${parts.length}` });
    pending = [];
  };
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.kind !== 'text') { pending.push(block); continue; }
    const chunks = splitDiagrams(block.text);
    if (!chunks.some(c => c.kind === 'diagram')) { pending.push(block); continue; }
    const definitions = referenceDefinitions(block.text);
    for (const chunk of chunks) {
      if (chunk.kind === 'native') {
        if (chunk.text.trim()) pending.push({ ...block, text: chunk.text + definitions });
      } else {
        flush();
        parts.push({ ...chunk, key: `diagram-${index}-${chunk.start}` });
      }
    }
  }
  flush();
  return parts;
}

function createAssistant(Native, uiT) {
  return function MermaidAssistant(props) {
    const theme = props.useMermaidTheme(s => s);
    const localeId = props.useMermaidLocale(s => s.active);
    const blocks = props.node?.data?.blocks;
    const parts = React.useMemo(() => Array.isArray(blocks) ? partitionBlocks(blocks) : [], [blocks]);
    const nativeRenderSlot = React.useCallback((key, owner, options) => props.renderSlot(ALIASES[key] || key, owner, options), [props.renderSlot]);
    const nativeProps = { ...props, renderSlot: nativeRenderSlot };
    if (props.groupPart === 'reasoning' || !Array.isArray(blocks) || !parts.length) return h(Native, nativeProps);
    const data = props.node.data;
    const originalLast = blocks[blocks.length - 1];
    const children = parts.map((part, index) => {
      if (part.kind === 'diagram') return h(Diagram, { key: part.key, source: part.source, theme, localeId, t: uiT });
      let nativeBlocks = part.blocks;
      if (data.status === 'running' && nativeBlocks[nativeBlocks.length - 1] !== originalLast) {
        // The native renderer marks only the last block as live reasoning.
        nativeBlocks = [...nativeBlocks, { kind: 'tool-call' }];
      }
      const status = data.status === 'interrupted' && index !== parts.length - 1 ? 'settled' : data.status;
      return h(Native, { ...nativeProps, key: part.key, node: { ...props.node, data: { ...data, blocks: nativeBlocks, status } } });
    });
    if (data.status === 'interrupted' && parts[parts.length - 1]?.kind === 'diagram') {
      children.push(h(Native, { ...nativeProps, key: 'interrupted', node: { ...props.node, data: { ...data, blocks: [] } } }));
    }
    return h('div', { className: 'dshmd-message' }, children);
  };
}

export const inject = ['slots', 'locale', 'theme'];
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, 'en', en.ui));
  ctx.effect(() => ctx.locale.register(NS, 'zh', zh.ui));
  const uiT = ctx.locale.bind(NS);
  const themeSource = {
    getSnapshot: () => ctx.theme.getTheme(),
    subscribe: callback => ctx.on('theme/change', callback)
  };
  const localeSource = {
    getSnapshot: () => ctx.locale.getSnapshot(),
    subscribe: callback => ctx.locale.subscribe(callback)
  };
  ctx.slots.inject(SLOT, () => {
    let stop = () => {};
    let current = [];
    let changing = false;
    let disposed = false;
    const sourceNames = Object.keys(ALIASES);
    const refresh = () => {
      if (changing || disposed) return;
      const original = ctx.slots.entries(SLOT).find(entry => entry.options.key === 'assistant-step' && entry.options.id !== ID);
      const sources = sourceNames.map(name => ctx.slots.entriesOfSlot(name)[0]);
      const next = [original, ...sources];
      if (next.every((entry, i) => entry === current[i])) return;
      changing = true;
      try {
        stop(); stop = () => {}; current = next;
        // Fail open to the native renderer if the integration contract changes.
        if (!original || original.store || !original.children ||
            Object.keys(original.children).some(name => !ALIASES[name]) ||
            sources.some(entry => entry?.store || Object.keys(entry?.children || {}).length)) {
          console.warn('[dsh-mermaid-diagrams] Unsupported chat renderer contract; native chat retained.');
          return;
        }
        const cleanups = [];
        stop = () => { for (const dispose of cleanups.splice(0).reverse()) dispose(); };
        try {
          const children = Object.fromEntries(sourceNames.map(name => [ALIASES[name], original.children[name] || { kind: 'single', scope: 'session' }]));
          const Native = original.component;
          cleanups.push(ctx.slots.register({
            name: SLOT, key: 'assistant-step', id: ID,
            priority: (original.options.priority ?? 0) - 1,
            locale: original.locale,
            children,
            inject: (...args) => {
              const native = original.inject?.(...args) || {};
              return { ...native, hooks: { ...native.hooks, mermaidTheme: themeSource, mermaidLocale: localeSource } };
            }
          }, createAssistant(Native, uiT)));
          sources.forEach((entry, i) => {
            if (!entry) return;
            cleanups.push(ctx.slots.register({ name: ALIASES[sourceNames[i]], locale: entry.locale, inject: entry.inject }, entry.component));
          });
        } catch (error) {
          stop();
          console.error('[dsh-mermaid-diagrams] Could not register adapter; native chat retained.', error);
        }
      } finally { changing = false; }
    };
    const unsubscribe = ctx.on('slots/changed', key => {
      if (key === SLOT || sourceNames.includes(key)) refresh();
    });
    refresh();
    return () => { disposed = true; unsubscribe(); stop(); };
  });
}
