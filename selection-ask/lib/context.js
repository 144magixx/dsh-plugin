/**
 * Pure helpers for dsh-selection-ask: request validation, the hidden thread's
 * boundary message, source-history seeding, and the compact view the browser
 * renders. Nothing here touches Cordis services, the filesystem, or timers.
 */

export const BOUNDARY_SOURCE = 'plugin:selection-ask';
export const LIMITS = Object.freeze({
  question: 20000, text: 20000, around: 8000, path: 4096, heading: 400,
  title: 80, messageText: 60000, messages: 80, tools: 40,
});
export const SELECTION_KINDS = Object.freeze(['chat', 'file', 'document', 'html']);

export class AskError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

export function clip(text, max) {
  const value = typeof text === 'string' ? text : '';
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function requiredId(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new AskError('invalid-request', `${name} is required.`);
  return value;
}

function optionalString(value, name, max) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new AskError('invalid-request', `${name} must be a string.`);
  return clip(value, max);
}

function optionalLine(value, name) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) throw new AskError('invalid-request', `${name} must be a positive line number.`);
  return value;
}

/**
 * Validate and bound a browser-supplied selection.
 * @param input - selection fields collected by the client.
 * @returns a detached selection with only known fields.
 */
export function normalizeSelection(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AskError('invalid-request', 'selection must be an object.');
  if (!SELECTION_KINDS.includes(input.kind)) throw new AskError('invalid-request', 'Unknown selection kind.');
  if (typeof input.text !== 'string' || !input.text.trim()) throw new AskError('empty-selection', 'The selected text is empty.');
  if (input.text.length > LIMITS.text) throw new AskError('selection-too-large', `Selections are limited to ${LIMITS.text} characters.`);
  const selection = { kind: input.kind, text: input.text };
  const path = optionalString(input.path, 'path', LIMITS.path);
  if (path) selection.path = path;
  const startLine = optionalLine(input.startLine, 'startLine');
  const endLine = optionalLine(input.endLine, 'endLine');
  if (startLine !== undefined) {
    selection.startLine = startLine;
    selection.endLine = endLine !== undefined && endLine >= startLine ? endLine : startLine;
  }
  if (input.turn !== undefined && input.turn !== null) {
    if (!Number.isSafeInteger(input.turn) || input.turn < 0) throw new AskError('invalid-request', 'turn must be a non-negative integer.');
    selection.turn = input.turn;
  }
  if (['user', 'assistant', 'tool'].includes(input.role)) selection.role = input.role;
  for (const key of ['heading', 'language']) {
    const value = optionalString(input[key], key, LIMITS.heading);
    if (value) selection[key] = value;
  }
  for (const key of ['before', 'after']) {
    const value = optionalString(input[key], key, LIMITS.around);
    if (value) selection[key] = value;
  }
  if (input.truncated === true) selection.truncated = true;
  return selection;
}

export const IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const IMAGE_LIMITS = Object.freeze({ count: 8, bytes: 10 * 1024 * 1024, totalBytes: 20 * 1024 * 1024 });

/**
 * Validate browser image uploads before Host attachment admission.
 * @param value - `{ data: base64, mediaType, name? }[]` or undefined.
 * @returns encoded image prompt parts in order.
 */
export function normalizeImages(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new AskError('invalid-request', 'images must be an array.');
  if (value.length > IMAGE_LIMITS.count) throw new AskError('too-many-images', `At most ${IMAGE_LIMITS.count} images per message.`);
  let total = 0;
  return value.map(image => {
    if (!image || typeof image.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw new AskError('invalid-image', 'Images must be base64 encoded.');
    if (!IMAGE_TYPES.includes(image.mediaType)) throw new AskError('invalid-image', 'Only PNG, JPEG, WebP and GIF images are supported.');
    const bytes = Math.floor(image.data.length * 3 / 4);
    total += bytes;
    if (bytes > IMAGE_LIMITS.bytes || total > IMAGE_LIMITS.totalBytes) throw new AskError('image-too-large', 'Images are limited to 10 MB each and 20 MB per message.');
    return { type: 'image', data: image.data, mediaType: image.mediaType, ...(typeof image.name === 'string' && image.name ? { name: clip(image.name, 200) } : {}) };
  });
}

export function normalizeModel(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || typeof value.provider !== 'string' || !value.provider || typeof value.model !== 'string' || !value.model) throw new AskError('invalid-request', 'model needs provider and model.');
  if (value.reasoningEffort !== undefined && (typeof value.reasoningEffort !== 'string' || !value.reasoningEffort)) throw new AskError('invalid-request', 'Invalid reasoning effort.');
  return { provider: clip(value.provider, 160), model: clip(value.model, 200), ...(value.reasoningEffort ? { reasoningEffort: clip(value.reasoningEffort, 40) } : {}) };
}

export function normalizeQuestion(value, { allowEmpty = false } = {}) {
  if (allowEmpty && (value === undefined || value === null || (typeof value === 'string' && !value.trim()))) return '';
  if (typeof value !== 'string' || !value.trim()) throw new AskError('empty-question', 'Enter a question.');
  if (value.length > LIMITS.question) throw new AskError('question-too-large', `Questions are limited to ${LIMITS.question} characters.`);
  return value;
}

export function titleFrom(question) {
  return clip(question.replace(/\s+/g, ' ').trim(), LIMITS.title);
}

/** A Markdown fence longer than any backtick run inside the text. */
export function fence(text) {
  let longest = 2;
  for (const match of String(text).matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return '`'.repeat(longest + 1);
}

function fenced(text, language = '') {
  const marker = fence(text);
  return `${marker}${language}\n${text}\n${marker}`;
}

/** Human/model-readable location of the selection. */
export function describeSource(selection) {
  const lines = selection.startLine === undefined ? '' : selection.endLine !== selection.startLine ? ` lines ${selection.startLine}-${selection.endLine}` : ` line ${selection.startLine}`;
  switch (selection.kind) {
    case 'chat': {
      const role = selection.role === 'user' ? 'a user message' : selection.role === 'tool' ? 'tool output' : 'an assistant reply';
      return `${role} in the conversation${selection.turn !== undefined ? ` (turn ${selection.turn})` : ''}`;
    }
    case 'html': return `the rendered HTML document ${selection.path ?? '(unknown path)'}${selection.heading ? `, section "${selection.heading}"` : ''}`;
    case 'document': return `the rendered document ${selection.path ?? '(unknown path)'}${lines}${selection.heading ? `, section "${selection.heading}"` : ''}`;
    default: return `the file ${selection.path ?? '(unknown path)'}${lines}`;
  }
}

/**
 * Text of the boundary message delivered before the first question.
 * @param thread - persisted thread record carrying the selection.
 * @returns plain text for a user-role context message.
 */
export function boundaryText(thread) {
  const s = thread.selection;
  const parts = [
    'Selection Ask boundary.',
    '',
    `The user selected a passage in the DeepSeek Harness interface and opened a side question about it. Everything before this message is inherited history from session "${thread.sourceSessionId}" and is context only: do not continue, repeat, or complete tasks, plans, or tool calls that appear only in that history. Answer the user's questions that follow this message.`,
    '',
    'You keep the same working directory, tools, and permissions as that session. Read files when it helps, and make real file changes only when the user asks for them; report exactly what you changed. This side conversation is hidden from the session list, so keep answers focused and self-contained.',
    '',
    `Selection source: ${describeSource(s)}.`,
  ];
  if (s.truncated) parts.push('The selection was truncated by the interface.');
  parts.push('Selected text:', fenced(s.text));
  if (s.before) parts.push('', 'Text just before the selection:', fenced(s.before));
  if (s.after) parts.push('', 'Text just after the selection:', fenced(s.after));
  return parts.join('\n');
}

/**
 * Seed for the hidden thread: the source's balanced prefix through its last
 * completed turn, marked the same way as a native fork.
 * @param events - source events with contiguous seqs from zero.
 * @returns `{ seed, inheritedEventCount }`, or an empty seed without a completed turn.
 */
export function forkSeed(events) {
  if (!Array.isArray(events)) return { seed: [], inheritedEventCount: 0 };
  let boundary = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'turn/end') { boundary = index; break; }
  }
  if (boundary < 0 || events[boundary].seq !== boundary) return { seed: [], inheritedEventCount: 0 };
  const seed = events.slice(0, boundary + 1);
  seed.push({ type: 'session/end-seed', seq: boundary + 1, time: events[boundary].time, data: { inherited: true } });
  return { seed, inheritedEventCount: boundary + 1 };
}

/**
 * Current model and permission settings recorded by a source observation.
 * @param events - source events.
 * @param values - projection values from the same observation.
 * @param fallback - live defaults when the log has no explicit choice.
 * @returns model route plus permission knobs; missing fields stay undefined.
 */
export function captureConfig(events = [], values = {}, fallback = {}) {
  let pending = null; let header = null; let sandbox; let approval; let preset;
  for (const event of events) {
    if (event.type === 'model/selection') pending = event.data;
    if (event.type === 'request/header') {
      const config = event.data?.header?.config;
      if (config?.provider && config?.model) {
        header = event.data.header;
        if (pending && pending.provider === config.provider && pending.model === config.model && pending.reasoningEffort === config.reasoningEffort) pending = null;
      }
    }
    if (event.type === 'sandbox/mode') sandbox = event.data?.mode;
    if (event.type === 'approval/policy') approval = event.data?.policy;
    if (event.type === 'permission/preset') preset = event.data?.preset;
  }
  const logged = header && {
    provider: header.config.provider, model: header.config.model,
    ...(header.config.reasoningEffort === undefined || header.adapterDefaults?.reasoningEffort === true ? {} : { reasoningEffort: header.config.reasoningEffort }),
  };
  const selection = pending ?? logged ?? values.modelSelection?.next ?? values.modelSelection?.lastUsed ?? fallback.model;
  const model = selection?.provider && selection?.model
    ? { provider: String(selection.provider), model: String(selection.model), ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: String(selection.reasoningEffort) }) }
    : undefined;
  const current = values.permissions?.currentValue;
  return {
    model,
    sandbox: sandbox ?? fallback.sandbox,
    approval: approval ?? fallback.approval,
    permissionPreset: current && current !== 'custom' ? current : preset && preset !== 'custom' ? preset : undefined,
    cwd: typeof values.workingDirectory === 'string' ? values.workingDirectory : undefined,
  };
}

function textOf(content, type = 'text') {
  if (!Array.isArray(content)) return '';
  return content.filter(block => block?.type === type && typeof block.text === 'string').map(block => block.text).join('\n\n');
}

/**
 * Fold the thread's own events into display messages.
 * @param events - hidden-session events at or above `floor`.
 * @param floor - inherited event count; older events are never shown.
 * @returns `{ messages, turnOpen }` bounded to the latest entries.
 */
export function foldMessages(events, floor = 0) {
  const messages = [];
  const tools = new Map();
  let assistant = null;
  let turnOpen = false;
  const ensureAssistant = (turn) => {
    if (!assistant || assistant.turn !== turn) {
      assistant = { id: `a-${messages.length}`, role: 'assistant', turn, text: '', reasoning: false, tools: [], status: 'running' };
      messages.push(assistant);
    }
    return assistant;
  };
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event.seq !== 'number' || event.seq < floor) continue;
    const data = event.data;
    switch (event.type) {
      case 'turn/start':
        turnOpen = true;
        break;
      case 'user/message': {
        if (data?.source?.kind !== 'user') break;
        const text = textOf(data.content);
        const images = Array.isArray(data.content) ? data.content.filter(block => block?.type === 'image').length : 0;
        if (!text.trim() && images === 0) break;
        messages.push({ id: String(data.id ?? `u-${event.seq}`), role: 'user', text: clip(text, LIMITS.messageText), ...(images ? { images } : {}) });
        assistant = null;
        break;
      }
      case 'assistant/message': {
        const content = data?.message?.content;
        const target = ensureAssistant(data?.turn);
        const text = textOf(content);
        if (text.trim()) target.text = clip(target.text ? `${target.text}\n\n${text}` : text, LIMITS.messageText);
        if (textOf(content, 'reasoning').trim()) target.reasoning = true;
        for (const block of Array.isArray(content) ? content : []) {
          if (block?.type !== 'tool-call') continue;
          const tool = { id: String(block.id ?? ''), name: String(block.name ?? '') || 'tool', status: 'running' };
          if (target.tools.length < LIMITS.tools) target.tools.push(tool);
          if (tool.id) tools.set(tool.id, tool);
        }
        break;
      }
      case 'tool/result': {
        const message = data?.message;
        const tool = tools.get(String(message?.toolCallId ?? message?.source?.callId ?? ''));
        if (tool) tool.status = message?.isError === true ? 'error' : 'done';
        break;
      }
      case 'turn/end': {
        turnOpen = false;
        const reason = data?.reason ?? {};
        if (assistant && assistant.turn === data?.turn) {
          assistant.status = reason.kind === 'completed' ? 'done' : reason.kind === 'aborted' || reason.kind === 'interrupted' ? 'stopped' : reason.kind === 'error' ? 'error' : 'done';
          if (reason.kind === 'error') assistant.error = clip(String(reason.error?.message ?? 'The model request failed.'), 1200);
          for (const tool of assistant.tools) if (tool.status === 'running') tool.status = 'stopped';
        } else if (reason.kind === 'error') {
          messages.push({ id: `e-${event.seq}`, role: 'assistant', turn: data?.turn, text: '', reasoning: false, tools: [], status: 'error', error: clip(String(reason.error?.message ?? 'The model request failed.'), 1200) });
        }
        assistant = null;
        break;
      }
      default:
        break;
    }
  }
  const trimmed = messages.length > LIMITS.messages;
  return { messages: trimmed ? messages.slice(-LIMITS.messages) : messages, trimmed, turnOpen };
}

/** Accumulate live assistant frames for one hidden agent. */
export function applyStreamFrame(state, frame) {
  if (!frame || typeof frame !== 'object') return state;
  if (frame.type === 'start') return { attemptId: frame.attemptId, text: '', reasoning: false };
  if (frame.type === 'end') return null;
  if (frame.type !== 'chunk' || !state || state.attemptId !== frame.attemptId) return state;
  const chunk = frame.chunk;
  if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
    const text = state.text + chunk.text;
    return { ...state, text: text.length > LIMITS.messageText ? text.slice(-LIMITS.messageText) : text };
  }
  if (chunk?.type === 'reasoning-delta') return state.reasoning ? state : { ...state, reasoning: true };
  return state;
}

/** Public, bounded projection of a stored thread for list rows and headers. */
export function publicThread(record, extra = {}) {
  return {
    id: record.id, sourceSessionId: record.sourceSessionId, title: record.title,
    selection: { ...record.selection, text: clip(record.selection.text, 600), before: undefined, after: undefined },
    createdAt: record.createdAt, updatedAt: record.updatedAt, ...extra,
  };
}

/** Validate one interaction answer from the browser. */
export function normalizeAnswer(pending, args) {
  if (pending.kind === 'approval') {
    if (!['allowed-once', 'rejected'].includes(args.outcome)) throw new AskError('invalid-request', 'outcome must be allowed-once or rejected.');
    return args.outcome;
  }
  if (!Array.isArray(args.answers)) throw new AskError('invalid-request', 'answers must be an array.');
  const known = new Map(pending.questions.map(question => [question.id, question]));
  const answers = [];
  for (const item of args.answers) {
    const question = known.get(item?.id);
    if (!question) throw new AskError('invalid-request', 'Unknown question id.');
    const options = new Set((question.options ?? []).map(option => option.label));
    const selected = Array.isArray(item.selected) ? item.selected.filter(label => typeof label === 'string' && options.has(label)) : [];
    if (!question.multiSelect && selected.length > 1) throw new AskError('invalid-request', 'This question accepts one choice.');
    const custom = typeof item.custom === 'string' && item.custom.trim() ? clip(item.custom, 4000) : undefined;
    answers.push({ id: question.id, selected: custom && !question.multiSelect ? [] : selected, ...(custom ? { custom } : {}) });
    known.delete(question.id);
  }
  for (const question of known.values()) answers.push({ id: question.id, selected: [] });
  return { answers };
}

/** Bounded, display-only copy of a user-questions request. */
export function publicQuestions(questions) {
  return (Array.isArray(questions) ? questions : []).slice(0, 8).map(question => ({
    id: String(question.id), question: clip(String(question.question ?? ''), 2000),
    ...(question.header ? { header: clip(String(question.header), 120) } : {}),
    multiSelect: question.multiSelect === true,
    ...(question.detail ? { detail: clip(String(question.detail), 6000) } : {}),
    options: (Array.isArray(question.options) ? question.options : []).slice(0, 12).map(option => ({ label: clip(String(option.label ?? ''), 200), ...(option.description ? { description: clip(String(option.description), 400) } : {}) })),
  }));
}
