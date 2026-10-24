import test from 'node:test';
import assert from 'node:assert/strict';
import { client } from './client-core.mjs';

const {
  deriveChat, aggregateChanges, deriveSubagents, deriveRelated, deriveJobs, deriveTodos, planModeActive,
  fileReferences, parseMcpName, callInfo, fileAddressFor, changesReviewAddress, subagentChatAddress, planAddress,
  changesSummaryUrl, formatDuration, formatTokens, basename, hostOf, EN,
} = client;

const t = (key, params = {}) => (EN[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
const plain = value => JSON.parse(JSON.stringify(value));

function snapshotOf(nodes, turns = []) {
  const turnMap = new Map(turns.map(turn => [turn.turn, { turn: turn.turn, data: { get: key => (key === 'deliverables' ? turn.deliverables : undefined) } }]));
  return { order: [], nodes: { values: () => nodes, get: () => undefined }, timeline: { turnOrder: turns.map(turn => turn.turn), turns: turnMap } };
}
const call = (seq, root) => ({ key: `n${seq}`, kind: 'tool-call', anchorSeq: seq, data: { root } });
const result = (name, args, meta, extra = {}) => ({ kind: 'tool-result', name, callId: extra.callId ?? `call-${name}-${Math.random()}`, args, call: { name, argsRaw: JSON.stringify(args) }, content: [], isError: false, meta, subCalls: [], ...extra });

test('deriveChat collects web, MCP, skills, references, plans, deliverables and change turns from one Chat snapshot', () => {
  const nodes = [
    call(5, result('web_search', { queries: ['dsh'] }, { sources: [{ url: 'https://example.com/a', title: 'Example A' }, { url: 'https://docs.test/b', title: 'Docs B' }, { url: 'javascript:alert(1)', title: 'bad' }], truncated: false })),
    call(3, { phase: 'start', callId: 'f1', name: 'web_fetch', argsRaw: JSON.stringify({ url: 'https://example.com/a' }) }),
    call(7, result('web_fetch', { url: 'https://redirect.test/x' }, { url: 'https://final.test/x', statusCode: 200, truncated: false })),
    call(8, { ...result('web_fetch', { url: 'https://failed.test/' }, undefined), isError: true }),
    call(9, result('mcp__github__search_issues', { q: 'bug' }, undefined)),
    call(10, { ...result('mcp__github__get_issue', { id: 1 }, undefined), isError: true }),
    call(11, result('read_mcp_resource', { server: 'docs', uri: 'x' }, undefined)),
    call(12, { phase: 'start', callId: 's1', name: 'skill', argsRaw: JSON.stringify({ name: 'office' }) }),
    call(13, { phase: 'preparing', callId: 'p1', name: 'web_fetch', args: { url: 'https://partial' } }),
    call(14, result('run_code', { code: '...' }, undefined, { subCalls: [{ kind: 'tool-result', name: 'web_fetch', args: { url: 'https://nested.test/doc' }, meta: { url: 'https://nested.test/doc', statusCode: 200 } }, { kind: 'tool-result', name: 'mcp__linear__list', args: {} }] })),
    call(15, result('present', { files: [{ path: 'report.md', description: 'Report' }] }, undefined)),
    call(16, result('exit_plan_mode', { plan: '# Ship the card\n\nSteps' }, undefined, { callId: 'plan-1' })),
    { key: 'u1', kind: 'user', anchorSeq: 1, data: { content: [{ type: 'text', text: '看看 @src/a.js，还有 @"docs/my file.md" 与 @someone 以及 @Review session 和 @lib/ 目录' }], referenceLabels: ['Review session'], skillNames: ['pdf'] } },
    { key: 'c1', kind: 'context', anchorSeq: 2, data: { source: { kind: 'session-reference', references: [{ sessionId: 'sess-2', label: 'Review session' }] } } },
    { key: 'c2', kind: 'context', anchorSeq: 4, data: { source: { kind: 'skill-invocation', name: 'docx' } } },
    { key: 'c3', kind: 'context', anchorSeq: 6, data: { source: { kind: 'skill-catalog', name: 'ignored' } } },
    { key: 'pl', kind: 'submitted-plan', anchorSeq: 17, visibility: 'hidden', data: { callId: 'plan-1', title: 'Ship the card', markdown: '# Ship the card' } },
  ];
  const snapshot = snapshotOf(nodes, [
    { turn: 1, deliverables: { produced: [], changes: { seq: 10 }, presented: [{ path: 'E:/w/out.pdf', seq: 12, index: 0 }] } },
    { turn: 2, deliverables: { produced: [], presented: [{ path: 'E:/w/chart.png', seq: 30, index: 0 }, { path: 'E:/w/out.pdf', description: 'final', seq: 31, index: 1 }] } },
    { turn: 3, deliverables: { produced: [], changes: { seq: 44 } } },
  ]);
  const chat = deriveChat(snapshot);
  assert.equal(deriveChat(snapshot), chat, 'cached per snapshot object');
  assert.deepEqual(plain(chat.web.map(item => [item.via, item.url, item.title ?? null])), [
    ['fetch', 'https://example.com/a', 'Example A'],
    ['fetch', 'https://final.test/x', null],
    ['fetch', 'https://nested.test/doc', null],
    ['search', 'https://docs.test/b', 'Docs B'],
  ]);
  assert.deepEqual(plain(chat.mcp.map(item => [item.server, item.calls, item.errors, item.tools.map(tool => tool.tool)])), [
    ['github', 2, 1, ['search_issues', 'get_issue']], ['docs', 1, 0, ['read_mcp_resource']], ['linear', 1, 0, ['list']],
  ]);
  assert.deepEqual(plain(chat.skills.map(item => item.name)), ['pdf', 'docx', 'office']);
  assert.deepEqual(plain(chat.files.map(item => [item.path, item.folder])), [['src/a.js', false], ['docs/my file.md', false], ['lib/', true]]);
  assert.deepEqual(plain(chat.sessions.map(item => [item.sessionId, item.label])), [['sess-2', 'Review session']]);
  assert.deepEqual(plain(chat.plans), [{ callId: 'plan-1', title: 'Ship the card', order: chat.plans[0].order }]);
  assert.deepEqual(plain(chat.presented.map(item => [item.path, item.description ?? null])), [['E:/w/out.pdf', 'final'], ['E:/w/chart.png', null]]);
  assert.deepEqual(plain(chat.changeTurns), [{ turn: 1, seq: 10 }, { turn: 3, seq: 44 }]);
});

test('deriveChat tolerates empty or foreign snapshots and falls back to present arguments', () => {
  assert.equal(deriveChat(undefined).web.length, 0);
  assert.equal(deriveChat({ nodes: {} }).mcp.length, 0);
  const chat = deriveChat(snapshotOf([call(1, result('present', { files: [{ path: 'a.md' }, { path: 'b.md', description: 'B' }] }, undefined))]));
  assert.deepEqual(plain(chat.presented.map(item => item.path)), ['b.md', 'a.md']);
});

test('callInfo prefers durable raw arguments and marks preparing calls pending', () => {
  assert.deepEqual(plain(callInfo({ phase: 'start', callId: 'x', name: 'skill', argsRaw: '{"name":"a"}', args: { name: 'partial' } })), { name: 'skill', args: { name: 'a' }, settled: false, error: false, pending: true, callId: 'x' });
  assert.equal(callInfo({ phase: 'preparing', name: 'web_fetch' }).pending, true);
  assert.equal(callInfo({ kind: 'tool-result', call: { name: 'web_fetch', argsRaw: '{bad' }, args: { url: 'u' }, isError: false }).args.url, 'u');
  assert.equal(callInfo(null), null);
});

test('aggregateChanges merges per-turn summaries by path and reports unavailable turns', () => {
  const summary = aggregateChanges([
    { turn: 1, seq: 10, status: 'ok', value: { turn: 1, files: [{ path: 'a.js', display: 'a.js', added: 3, deleted: 1 }, { path: 'b.bin', display: 'b.bin', added: 0, deleted: 0, binary: true }], total: 2, added: 3, deleted: 1 } },
    { turn: 2, seq: 20, status: 'ok', value: { turn: 2, files: [{ path: 'a.js', display: 'a.js', added: 2, deleted: 2 }], total: 1, added: 2, deleted: 2 } },
    { turn: 3, seq: 30, status: 'missing' },
    { turn: 4, seq: 40, status: 'loading' },
    { turn: 5, seq: 50, status: 'error' },
  ]);
  assert.deepEqual(plain(summary.files.map(file => [file.path, file.added, file.deleted, file.binary, file.turns, file.latest])), [
    ['a.js', 5, 3, false, 2, { seq: 20, turn: 2, index: 0 }],
    ['b.bin', 0, 0, true, 1, { seq: 10, turn: 1, index: 1 }],
  ]);
  assert.deepEqual([summary.added, summary.deleted, summary.missing, summary.loading, summary.failed, summary.recorded, summary.turns], [5, 3, 1, 1, 1, 2, 5]);
  assert.equal(aggregateChanges([]).turns, 0);
});

test('deriveSubagents mirrors the native catalog status, elapsed time and token formulas', () => {
  const catalog = [
    { id: 'c1', mode: 'one-shot', label: 'audit', createdAt: 1 },
    { id: 'c2', mode: 'continuable', label: 'coder', createdAt: 2 },
    { id: 'c3', mode: 'external', label: 'ext', createdAt: 3 },
    { id: 'c4', mode: 'weird', createdAt: 4 },
  ];
  const byId = {
    c1: { running: false, title: 'Audit docs', projectionValues: { subagentTiming: { settledMs: 5000, lastTurnCompleted: true }, tokenUsage: { uncachedInputTokens: 1000, outputTokens: 200, cacheReadTokens: 300, cacheWriteTokens: 0 } } },
    c2: { running: false, projectionValues: { subagentTiming: { settledMs: 1000, active: { since: 10000, through: 12000 } } } },
  };
  const result = deriveSubagents(catalog, new Map([['c2', { running: true }]]), byId, 15000);
  assert.deepEqual(plain(result.items.map(item => [item.id, item.state, item.mode, item.elapsedMs ?? null, item.tokens ?? null, item.title ?? null])), [
    ['c2', 'running', 'continuable', 6000, null, null],
    ['c1', 'done', 'one-shot', 5000, 1500, 'Audit docs'],
    ['c4', 'idle', 'unknown', null, null, null],
    ['c3', 'external', 'external', null, null, null],
  ]);
  assert.deepEqual([result.running, result.done, result.idle], [1, 1, 1]);
  const settled = deriveSubagents([{ id: 'c2', mode: 'continuable' }], new Map(), byId, 15000);
  assert.equal(settled.items[0].elapsedMs, 3000, 'inactive child freezes at active.through');
});

test('deriveRelated lists parent, forks, side branches and the side-branch source', () => {
  const list = { ids: ['cur', 'p', 'f1', 'f2', 'sub'], byId: {
    cur: { id: 'cur', parentId: 'p', title: 'Current' }, p: { id: 'p', displayTitle: 'Parent', running: true },
    f1: { id: 'f1', parentId: 'cur', title: 'Current · 自第 3 轮' }, f2: { id: 'f2', parentId: 'cur', title: 'Another fork' },
    sub: { id: 'sub', parentId: 'cur', origin: 'subagent', title: 'child' },
  } };
  assert.deepEqual(plain(deriveRelated('cur', list, ['f2'], null).map(item => [item.relation, item.id, item.title, item.archived, item.running])), [
    ['forkSource', 'p', 'Parent', false, true], ['sideBranch', 'f1', 'Current · 自第 3 轮', false, false], ['fork', 'f2', 'Another fork', true, false],
  ]);
  const child = { ids: ['x', 'parent'], byId: { x: { parentId: 'parent', origin: 'subagent' }, parent: { title: 'Root' } } };
  assert.equal(deriveRelated('x', child, [], null)[0].relation, 'parent');
  const branch = deriveRelated('cur', list, [], { sourceSessionId: 'src', turn: 1, mode: 'edit' });
  assert.deepEqual(plain([branch[0].relation, branch[0].id, branch[0].turn]), ['branchSource', 'src', 1]);
});

test('jobs, todos and plan mode derive like the native header controls', () => {
  const jobs = deriveJobs([
    { id: 'bash-1', kind: 'bash', label: 'npm test', status: 'completed', startedAt: 1000, finishedAt: 4000 },
    { id: 'pwsh-2', kind: 'pwsh', label: 'build', status: 'running', startedAt: 2000 },
    { id: 'wf-3', kind: 'workflow', label: '', status: 'failed', startedAt: 500, finishedAt: 6000 },
    null,
  ], 10000);
  assert.deepEqual(plain(jobs.items.map(job => [job.id, job.live, job.durationMs, job.label])), [['pwsh-2', true, 8000, 'build'], ['wf-3', false, 5500, 'wf-3'], ['bash-1', false, 3000, 'npm test']]);
  assert.equal(jobs.running, 1);
  assert.deepEqual(plain(deriveTodos([{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }, { bad: true }])), { items: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }], done: 1, total: 2 });
  assert.equal(planModeActive({ active: true, pending: false }), true);
  assert.equal(planModeActive({ active: true, pending: true }), false);
  assert.equal(planModeActive({ active: false, pending: true }), true);
  assert.equal(planModeActive(null), false);
});

test('references, MCP names and addresses follow the native grammars', () => {
  assert.deepEqual(plain(fileReferences('@a/b.js, @"x y/z.md" @plain email@x.com @[S](dsh-session:abc) @dir/', [])), [{ path: 'a/b.js', folder: false }, { path: 'x y/z.md', folder: false }, { path: 'dir/', folder: true }]);
  assert.deepEqual(plain(fileReferences('@My Session @src/x.ts', ['My Session'])), [{ path: 'src/x.ts', folder: false }]);
  assert.deepEqual(plain(parseMcpName('mcp__git_hub__create__issue')), { server: 'git_hub', tool: 'create__issue' });
  assert.equal(parseMcpName('web_fetch'), null);
  assert.equal(fileAddressFor('s 1', 'E:\\proj', 'E:\\proj\\docs\\a b.md'), 'dsh-resource://file/session/s%201/docs/a%20b.md');
  assert.equal(fileAddressFor('s1', 'E:\\proj', './x/y.js'), 'dsh-resource://file/session/s1/x/y.js');
  assert.equal(fileAddressFor('s1', 'E:\\proj', 'D:\\other\\z.txt'), 'dsh-resource://file/session/s1/D:/other/z.txt');
  assert.equal(fileAddressFor('s1', '/home/u/p', '/home/u/p'), 'dsh-resource://file/session/s1/');
  // macOS paths: inside the project become relative; outside keep the absolute path (native grammar).
  assert.equal(fileAddressFor('s1', '/Users/me/My Proj/', '/Users/me/My Proj/docs/使用.md'), 'dsh-resource://file/session/s1/docs/%E4%BD%BF%E7%94%A8.md');
  assert.equal(fileAddressFor('s1', '/Users/me/proj', '/Users/me/other/z.txt'), 'dsh-resource://file/session/s1//Users/me/other/z.txt');
  assert.equal(changesReviewAddress('a/b', 12, 3), 'dsh-resource://changes-review/session/a%2Fb/12/3');
  assert.equal(subagentChatAddress('p', 'c/1', 'one-shot'), 'dsh-resource://subagentchat/session/c%2F1?parent=p&mode=one-shot');
  assert.equal(planAddress('s', null, 'call 1'), 'dsh-resource://plan/s/call%201');
  assert.equal(planAddress('child', { address: { parentSessionId: 'p', childSessionId: 'child', mode: 'continuable' } }, 'c'), 'dsh-resource://plan/subagent/p/child/continuable/c');
  assert.equal(changesSummaryUrl('s&1', 7), 'api/changes.summary?sessionId=s%261&seq=7');
});

test('formatting matches the native subagent catalog', () => {
  assert.equal(formatDuration(5000, t), '5s');
  assert.equal(formatDuration(65000, t), '1m 05s');
  assert.equal(formatDuration(2 * 3600000 + 60000, t), '2h 01m');
  assert.equal(formatDuration(26 * 3600000, t), '1d 2h');
  assert.equal(formatTokens(999, t), '999 tok');
  assert.equal(formatTokens(1500, t), '1.5K tok');
  assert.equal(formatTokens(2500000, t), '2.5M tok');
  assert.equal(formatTokens(undefined, t), '');
  assert.equal(basename('E:\\dsh-plugin\\session-summary\\'), 'session-summary');
  assert.equal(basename('/a/b/c.md'), 'c.md');
  assert.equal(hostOf('https://www.example.com/x'), 'example.com');
  assert.equal(client.displayPath('E:\\research\\paper', 'E:\\research\\paper\\docs\\a.md'), 'docs/a.md');
  assert.equal(client.displayPath('E:\\research\\paper', 'D:\\other\\a.md'), 'D:\\other\\a.md');
  assert.equal(client.displayPath(undefined, 'docs/a.md'), 'docs/a.md');
  assert.equal(basename('/Users/me/dsh-plugin/session-summary/'), 'session-summary');
  assert.equal(client.displayPath('/Users/me/proj', '/Users/me/proj/src/a.js'), 'src/a.js');
  assert.equal(client.displayPath('/Users/me/proj', '/Users/me/project2/a.js'), '/Users/me/project2/a.js');
});
