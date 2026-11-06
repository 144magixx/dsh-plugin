import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const requireReact = createRequire(new URL('../../mermaid-diagrams-preview/package.json', import.meta.url));
const React = requireReact('react');
const { renderToStaticMarkup } = requireReact('react-dom/server');
let registration;
vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load(value) { registration = value; } } }, AbortController, console });
const c = registration.factory(() => React);
const plain = value => JSON.parse(JSON.stringify(value));
function memoryStorage(initial) { const map = new Map(initial ? [[c.LAYOUT_KEY, initial]] : []); return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) }; }

test('stored order wins; newly registered cards join beside their registration neighbours', () => {
  assert.deepEqual(plain(c.arrangeCards(['cap', 'fav', 'todo', 'guard'], [])), ['cap', 'fav', 'todo', 'guard']);
  assert.deepEqual(plain(c.arrangeCards(['cap', 'fav', 'todo', 'guard'], ['guard', 'cap', 'fav'])), ['guard', 'cap', 'fav', 'todo'], 'todo joins after fav');
  assert.deepEqual(plain(c.arrangeCards(['new', 'cap'], ['cap'])), ['new', 'cap'], 'a first-registered newcomer goes first');
  assert.deepEqual(plain(c.arrangeCards(['cap'], ['gone', 'cap', 'cap', 3])), ['cap'], 'absent, duplicate and invalid ids are ignored');
  assert.deepEqual(plain(c.moveCard(['a', 'b', 'c'], 'a', 2)), ['b', 'c', 'a']);
});

test('committing a visible order keeps hidden and temporarily absent cards in place', () => {
  const all = ['cap', 'fav', 'todo', 'guard'];
  assert.deepEqual(plain(c.commitOrder(all, ['todo', 'cap', 'guard'], new Set(['fav']), [])), ['todo', 'fav', 'cap', 'guard']);
  assert.deepEqual(plain(c.commitOrder(['cap', 'todo'], ['todo', 'cap'], new Set(), ['cap', 'off', 'todo'])), ['todo', 'cap', 'off'], 'a disabled plugin keeps its slot after its predecessor');
});

test('layout persists per browser and tolerates broken storage', () => {
  const storage = memoryStorage(JSON.stringify({ order: ['b', 'a'], hidden: ['x'] }));
  const layout = c.createCardLayout(storage);
  assert.deepEqual(plain(layout.getSnapshot()), { order: ['b', 'a'], hidden: ['x'] });
  let changes = 0; layout.subscribe(() => changes++);
  layout.set({ hidden: [] });
  assert.deepEqual(JSON.parse(storage.map.get(c.LAYOUT_KEY)), { order: ['b', 'a'], hidden: [] });
  layout.reset();
  assert.equal(storage.map.has(c.LAYOUT_KEY), false); assert.equal(changes, 2);
  assert.deepEqual(plain(c.createCardLayout(memoryStorage('{oops')).getSnapshot()), { order: [], hidden: [] });
  const failing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const fallback = c.createCardLayout(failing);
  fallback.set({ order: ['a'] });
  assert.deepEqual(plain(fallback.getSnapshot().order), ['a'], 'kept in memory when storage is unavailable');
});

test('the slot source enumerates registrations with a stable snapshot', () => {
  let entries = [{ options: { id: 'dsh-task-guardian', order: 100 } }, { options: { id: 'dsh-todo', order: 60, label: () => '待办' } }, { options: { id: 'dsh-todo', order: 60 } }, { options: {} }];
  const listeners = new Set();
  const source = c.slotCardSource({ entries: () => entries, subscribe: (name, fn) => { assert.equal(name, c.ACCESSORIES); listeners.add(fn); return () => listeners.delete(fn); } });
  const first = source.read();
  assert.deepEqual(plain(first.map(row => row.id)), ['dsh-todo', 'dsh-task-guardian']);
  assert.equal(source.read(), first, 'unchanged registrations keep the same snapshot');
  const stop = source.subscribe(() => {}); assert.equal(listeners.size, 1); stop(); assert.equal(listeners.size, 0);
  entries = [...entries, { options: { id: 'dsh-new', order: 70 } }];
  assert.deepEqual(plain(source.read().map(row => row.id)), ['dsh-todo', 'dsh-new', 'dsh-task-guardian']);
  assert.equal(c.slotCardSource({}).read(), null, 'hosts without enumeration fall back');
  assert.equal(c.cardLabel({ id: 'x', label: () => { throw new Error('locale'); } }, key => key), 'x');
  assert.equal(c.cardLabel(first[0], key => key), '待办');
});

test('the stack renders every visible card with a grip, and the hidden-card entry', () => {
  const layout = c.createCardLayout(memoryStorage(JSON.stringify({ order: ['todo', 'cap'], hidden: ['guard'] })));
  const t = key => ({ cardsGrip: '拖动', cardsHidden: '已隐藏 {count} 张卡片', cardsManage: '管理卡片…' })[key] || key;
  const rows = [{ id: 'cap', label: '外部能力' }, { id: 'todo', label: '待办' }, { id: 'guard', label: '任务' }];
  const html = renderToStaticMarkup(React.createElement(c.CardStack, { rows, layout, t, renderCard: id => React.createElement('div', null, `card:${id}`) }));
  assert.deepEqual([...html.matchAll(/data-dsc-card="([^"]+)"/g)].map(match => match[1]), ['todo', 'cap']);
  assert.equal((html.match(/class="dsc-grip"/g) || []).length, 2);
  assert.match(html, /已隐藏 1 张卡片 · 管理卡片/);
  assert.doesNotMatch(html, /card:guard/);
});
