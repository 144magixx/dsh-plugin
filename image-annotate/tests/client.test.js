import test from 'node:test';
// Loose deep equality: helper results come from the vm realm (different prototypes).
import assert from 'node:assert';
import { client, requested } from './client-core.mjs';

const measure = (text, size) => text.length * size * 0.5;

test('the client only requires shell-provided modules and declares its injections', () => {
  assert.deepEqual([...new Set(requested)].sort(), ['react', 'react-dom']);
  assert.equal(client.name, 'dsh-image-annotate');
  assert.deepEqual(client.inject, ['slots', 'locale']);
  assert.equal(client.SLOT, 'conversation.input.attachments');
  assert.deepEqual(Object.keys(client.ZH).sort(), Object.keys(client.EN).sort(), 'zh and en dictionaries match');
  for (const tool of client.TOOLS) assert.ok(client.ZH[`tool.${tool.id}`], `label for ${tool.id}`);
  assert.equal(new Set(client.TOOLS.map((tool) => tool.key)).size, client.TOOLS.length, 'tool shortcuts are unique');
});

test('output keeps encodable types and renames the rest to PNG', () => {
  assert.equal(client.outputType('image/jpeg'), 'image/jpeg');
  assert.equal(client.outputType('image/webp'), 'image/webp');
  assert.equal(client.outputType('image/gif'), 'image/png');
  assert.equal(client.outputType(''), 'image/png');
  assert.equal(client.outputName('shot.png', 'image/png', 'image/png'), 'shot.png');
  assert.equal(client.outputName('anim.gif', 'image/gif', 'image/png'), 'anim.png');
  assert.equal(client.outputName('', 'image/png', 'image/png'), 'image.png');
  assert.equal(client.outputName('photo.v2.jpeg', 'image/webp', 'image/jpeg'), 'photo.v2.jpg');
  assert.equal(client.outputName('noext', 'image/heic', 'image/png'), 'noext.png');
});

test('replacement plans remove the target and every later rail item, in order', () => {
  const file = (name) => ({ name });
  const rail = [
    { id: 'a', kind: 'image', file: file('a') },
    { id: 'b', kind: 'image', file: file('b') },
    { id: 'c', kind: 'file', file: file('c') },
    { id: 'd', kind: 'image', file: file('d') },
  ];
  const plan = client.planReplace(rail, 'b');
  assert.equal(plan.index, 1);
  assert.deepEqual(plan.removed.map((item) => item.id), ['b', 'c', 'd']);
  assert.deepEqual(client.planReplace(rail, 'd').removed.map((item) => item.id), ['d']);
  assert.equal(client.planReplace(rail, 'c'), null, 'files are not editable');
  assert.equal(client.planReplace(rail, 'missing'), null);
  assert.equal(client.planReplace(undefined, 'a'), null);
  assert.equal(client.planReplace([{ id: 'x', kind: 'image' }], 'x'), null, 'no File to re-add');
});

test('the edit target follows its File after a restore re-adds it under a new id', () => {
  const file = { name: 'a.png' };
  const restored = [{ id: 'new-7', kind: 'image', file }];
  assert.equal(client.targetId(restored, { id: 'old-1', file }), 'new-7');
  assert.equal(client.targetId(restored, { id: 'old-1', file: { name: 'other' } }), 'old-1');
  assert.equal(client.targetId(undefined, { id: 'old-1', file }), 'old-1');
});

test('sizes scale with the image and restyle updates the right field', () => {
  assert.equal(client.unitFor(400, 300), 0.5);
  assert.equal(client.unitFor(2000, 1000), 2);
  assert.equal(client.sizeValue('rect', 'm', 2), 12);
  assert.equal(client.sizeValue('text', 's', 1), 22);
  assert.equal(client.sizeValue('marker', 'l', 1), 26);
  assert.ok(client.sizeValue('mosaic', 'l', 1) > client.sizeValue('mosaic', 's', 1), 'thick mosaic uses bigger blocks');
  const text = { type: 'text', size: 32, color: '#ff3b30', sizeKey: 'm' };
  assert.deepEqual(client.restyle(text, { sizeKey: 'l' }, 1), { ...text, size: 48, sizeKey: 'l' });
  const mosaic = { type: 'mosaic', block: 14, color: '#ff3b30' };
  assert.equal(client.restyle(mosaic, { color: '#000000' }, 1).color, '#ff3b30', 'mosaic has no color');
  assert.equal(client.restyle({ type: 'marker', r: 18 }, { sizeKey: 's' }, 1).r, 13);
  assert.equal(client.restyle({ type: 'arrow', width: 6 }, { sizeKey: 'l', color: '#0a84ff' }, 1).width, 10);
});

test('markers number upward from the highest existing marker', () => {
  assert.equal(client.nextMarkerNumber([]), 1);
  assert.equal(client.nextMarkerNumber([{ type: 'marker', n: 1 }, { type: 'rect' }, { type: 'marker', n: 4 }]), 5);
});

test('shift constrains boxes to squares and arrows to 45 degrees', () => {
  assert.deepEqual(client.constrain('rect', 0, 0, 10, 4, false), { x2: 10, y2: 4 });
  assert.deepEqual(client.constrain('rect', 0, 0, 10, -4, true), { x2: 10, y2: -10 });
  const arrow = client.constrain('arrow', 0, 0, 10, 1, true);
  assert.ok(Math.abs(arrow.y2) < 1e-9 && Math.abs(arrow.x2 - Math.hypot(10, 1)) < 1e-9);
  const diagonal = client.constrain('arrow', 0, 0, 10, 9, true);
  assert.ok(Math.abs(diagonal.x2 - diagonal.y2) < 1e-9);
});

test('hit testing follows strokes, borders, markers and text boxes', () => {
  const rect = { type: 'rect', x1: 10, y1: 10, x2: 110, y2: 60, width: 4 };
  assert.ok(client.hitTest(rect, 10, 30, 3, measure), 'left border');
  assert.ok(!client.hitTest(rect, 60, 35, 3, measure), 'hollow center');
  assert.ok(!client.hitTest(rect, 200, 35, 3, measure));
  const ellipse = { type: 'ellipse', x1: 0, y1: 0, x2: 100, y2: 50, width: 4 };
  assert.ok(client.hitTest(ellipse, 100, 25, 3, measure));
  assert.ok(!client.hitTest(ellipse, 50, 25, 3, measure));
  const pen = { type: 'pen', points: [[0, 0], [50, 0], [50, 50]], width: 6 };
  assert.ok(client.hitTest(pen, 25, 2, 1, measure));
  assert.ok(!client.hitTest(pen, 25, 25, 1, measure));
  assert.ok(client.hitTest({ type: 'pen', points: [[5, 5]], width: 6 }, 7, 5, 0, measure), 'a dot');
  assert.ok(client.hitTest({ type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 100, width: 4 }, 50, 51, 2, measure));
  assert.ok(client.hitTest({ type: 'marker', x: 20, y: 20, r: 10 }, 27, 27, 0, measure));
  const text = { type: 'text', x: 10, y: 10, text: 'ab\nabcd', size: 20 };
  assert.deepEqual(client.shapeBounds(text, measure), { x: 10, y: 10, w: 40, h: 50 });
  assert.ok(client.hitTest(text, 45, 55, 0, measure));
  assert.ok(client.hitTest({ type: 'mosaic', x1: 0, y1: 0, x2: 40, y2: 40, block: 8 }, 20, 20, 0, measure), 'mosaic is solid');
});

test('pick returns the topmost shape', () => {
  const below = { id: 'below', type: 'marker', x: 10, y: 10, r: 10 };
  const above = { id: 'above', type: 'marker', x: 12, y: 12, r: 10 };
  assert.equal(client.pick([below, above], 11, 11, 0, measure).id, 'above');
  assert.equal(client.pick([below, above], 100, 100, 0, measure), null);
});

test('translate moves every shape kind without mutating it', () => {
  const pen = { type: 'pen', points: [[0, 0], [1, 1]] };
  assert.deepEqual(client.translate(pen, 2, 3).points, [[2, 3], [3, 4]]);
  assert.deepEqual(pen.points, [[0, 0], [1, 1]]);
  assert.deepEqual(client.translate({ type: 'text', x: 1, y: 1 }, 1, 1), { type: 'text', x: 2, y: 2 });
  assert.deepEqual(client.translate({ type: 'rect', x1: 0, y1: 0, x2: 1, y2: 1 }, 5, 5), { type: 'rect', x1: 5, y1: 5, x2: 6, y2: 6 });
});

test('tiny boxes and empty text are discarded as accidental', () => {
  assert.ok(!client.isMeaningful({ type: 'rect', x1: 0, y1: 0, x2: 2, y2: 50 }, 3));
  assert.ok(client.isMeaningful({ type: 'ellipse', x1: 0, y1: 0, x2: 5, y2: 5 }, 3));
  assert.ok(!client.isMeaningful({ type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1 }, 3));
  assert.ok(client.isMeaningful({ type: 'pen', points: [[0, 0]] }, 3), 'a single pen dot is kept');
  assert.ok(!client.isMeaningful({ type: 'text', text: '  ' }, 3));
});

test('history supports undo and redo and drops the redo branch on new edits', () => {
  let doc = client.history();
  doc = client.pushHistory(doc, ['a']);
  doc = client.pushHistory(doc, ['a', 'b']);
  assert.equal(client.pushHistory(doc, doc.shapes), doc, 'same snapshot is a no-op');
  doc = client.undoHistory(doc);
  assert.deepEqual(doc.shapes, ['a']);
  doc = client.redoHistory(doc);
  assert.deepEqual(doc.shapes, ['a', 'b']);
  doc = client.undoHistory(client.undoHistory(doc));
  assert.deepEqual(doc.shapes, []);
  assert.equal(client.undoHistory(doc), doc);
  doc = client.pushHistory(doc, ['c']);
  assert.equal(doc.future.length, 0);
  let long = client.history();
  for (let i = 0; i < 130; i++) long = client.pushHistory(long, [i]);
  assert.equal(long.past.length, 100, 'history is bounded');
});

test('luminance separates light and dark colors', () => {
  assert.ok(client.luminance('#ffffff') > 0.9);
  assert.ok(client.luminance('#1c1c1e') < 0.2);
  assert.ok(client.luminance('#ffcc00') > 0.72, 'yellow markers get dark digits');
  assert.equal(client.luminance('nope'), 0);
});

test('registerReplacement wraps the native entry one priority ahead and follows changes', () => {
  const listeners = new Set();
  let entries = [{ options: { name: 'conversation.input.attachments' }, component: 'NativeA', inject: 'injectA', locale: 'conversation' }];
  const registered = [];
  const ctx = { slots: {
    entries: () => entries,
    subscribe: (_, fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    register(options, component) { const record = { options, component, live: true }; registered.push(record); return () => { record.live = false; }; },
  } };
  const stop = client.registerReplacement(ctx, 'conversation.input.attachments', 'own', (Native) => `wrapped:${Native}`);
  assert.equal(registered.length, 1);
  assert.deepEqual(registered[0].options, { name: 'conversation.input.attachments', id: 'own', locale: 'conversation', inject: 'injectA', priority: -1 });
  assert.equal(registered[0].component, 'wrapped:NativeA');
  entries = [registered[0], ...entries].map((item) => item.options.id === 'own' ? item : item);
  for (const fn of listeners) fn();
  assert.equal(registered.length, 1, 'own entry is ignored; unchanged original is not re-wrapped');
  entries = [{ options: { name: 'conversation.input.attachments', priority: 5 }, component: 'NativeB', locale: 'conversation' }];
  for (const fn of listeners) fn();
  assert.equal(registered[0].live, false);
  assert.equal(registered[1].component, 'wrapped:NativeB');
  assert.equal(registered[1].options.priority, 4);
  stop();
  assert.equal(registered[1].live, false);
  assert.equal(listeners.size, 0);
});

test('findThumbnail resolves only normal draft image thumbnails', () => {
  const node = (tag, extra = {}) => ({ tagName: tag, children: [], ...extra });
  const img = node('IMG', { getAttribute: () => 'blob:one' });
  const button = node('BUTTON', { children: [img] });
  img.closest = () => button;
  const removeButton = node('BUTTON', { children: [node('SVG')] });
  removeButton.closest = () => removeButton;
  const host = { contains: (target) => target === img || target === button || target === removeButton };
  const attachments = [{ id: 'one', kind: 'image', previewUrl: 'blob:one', file: {} }];
  assert.equal(client.findThumbnail(img, host, attachments, {}).attachment.id, 'one');
  assert.equal(client.findThumbnail(img, host, attachments, { one: { status: 'uploading' } }).button, button);
  assert.equal(client.findThumbnail(img, host, attachments, { one: { status: 'error' } }), null, 'retry control stays native');
  assert.equal(client.findThumbnail(removeButton, host, attachments, {}), null);
  assert.equal(client.findThumbnail(img, { contains: () => false }, attachments, {}), null, 'outside the rail (e.g. editor portal)');
  assert.equal(client.findThumbnail(img, host, [{ id: 'one', kind: 'file', previewUrl: 'blob:one' }], {}), null);
});
