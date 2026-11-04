import test from 'node:test';
import assert from 'node:assert/strict';
import { splitDiagrams, looksLikeMermaid, validateSource, referenceDefinitions } from '../src/parse.mjs';

test('replaces sequence and flowchart fences in order without losing prose', () => {
  const text = 'Before\n\n```mermaid\nsequenceDiagram\nA->>B: 中文消息\n```\n\nBetween\n~~~mermaid\nflowchart LR\nA-->B\n~~~\nAfter';
  const parts = splitDiagrams(text);
  assert.equal(parts.filter(p => p.kind === 'diagram').length, 2);
  assert.equal(parts.map(p => p.kind === 'diagram' ? p.raw : p.text).join(''), text);
});
test('streaming fence remains native until closed', () => {
  const open = '```mermaid\nflowchart LR\nA-->';
  assert.deepEqual(splitDiagrams(open).map(p => p.kind), ['native']);
  assert.deepEqual(splitDiagrams(open + 'B\n```').map(p => p.kind), ['diagram']);
});
test('does not parse Mermaid inside an outer code sample', () => {
  const text = '````markdown\n```mermaid\nflowchart LR\nA-->B\n```\n````';
  assert.deepEqual(splitDiagrams(text).map(p => p.kind), ['native']);
});
test('only recognizes unlabelled Mermaid, never ordinary code languages', () => {
  assert.equal(splitDiagrams('```\nsequenceDiagram\nA->>B: Hi\n```')[0].kind, 'diagram');
  assert.equal(splitDiagrams('```javascript\nsequenceDiagram\n```')[0].kind, 'native');
  assert.equal(looksLikeMermaid('some ordinary text'), false);
});
test('supports CRLF, uppercase labels, long fences and Mermaid comments', () => {
  const text = '````MERMAID\r\n%% hi\r\nflowchart TD\r\nA-->B\r\n`````\r\n';
  assert.equal(splitDiagrams(text)[0].kind, 'diagram');
});
test('ignores quotes and indented examples', () => {
  for (const text of ['> ```mermaid\n> flowchart LR\n> A-->B\n> ```', '    ```mermaid\n    flowchart LR\n    A-->B\n    ```', '- item\n  ```mermaid\n  flowchart LR\n  A-->B\n  ```']) assert.equal(splitDiagrams(text)[0].kind, 'native');
});
test('rejects configuration overrides and external CSS references', () => {
  for (const text of ['%%{init: {securityLevel: "loose"}}%%\nflowchart LR\nA-->B', '---\nconfig: {}\n---\nflowchart LR', 'flowchart LR\nclassDef x fill:url(https://example.org/x)', 'x'.repeat(30001)]) assert.throws(() => validateSource(text));
  assert.doesNotThrow(() => validateSource('sequenceDiagram\nA->>B: 请求登录'));
});
test('collects link definitions without reading fenced code examples', () => {
  const text = '[Doc][x]\n```\n[bad]: https://bad.test\n```\n[x]: https://example.test';
  assert.equal(referenceDefinitions(text), '\n\n[x]: https://example.test');
});
