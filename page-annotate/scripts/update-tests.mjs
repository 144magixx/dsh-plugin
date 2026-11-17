import fs from 'node:fs';
const file='page-annotate/tests/client.test.js';
let s=fs.readFileSync(file,'utf8');
s=s.replace('console, setTimeout, clearTimeout,','console, setTimeout, clearTimeout, Uint8Array, btoa,');
s=s.replace("assert.match(text, /^请根据以下页面批注修改 `report\\/joyrisk\\.html`/)", "assert.match(text, /# 页面批注（3 条）/)\n  assert.match(text, /来源文件：`\\/w\\/proj\\/report\\/joyrisk\\.html`/)\n  assert.match(text, /提问或疑惑应结合页面解释/)\n  assert.match(text, /不要擅自修改/)");
s=s.replace('assert.match(text, /意见：字号改小 \\/ 颜色换品牌蓝/)', 'assert.match(text, /批注：字号改小\\n颜色换品牌蓝/)');
s=s.replace('/样式调整：font-size', '/预览中试调的样式：font-size');
s=s.replace('/意见：（未填写/', '/批注：（未填写/');
s=s.replace('/文字改为：“新的文字”/', '/预览中试调的文字：“新的文字”/');
s=s.replace("textChange: { before: '旧', after: '新的文字' }", "textChange: { before: '旧', after: '新的文字' }, hasShot: true");
const a=s.indexOf("test('insertDraft writes"),b=s.indexOf("test('frameState",a);
s=s.slice(0,a)+`test('native reference preserves the draft and carries a compact label, including Windows separators', () => {
  let captured
  const actx = {}
  const input = { state: { getSnapshot: () => ({draft: '解释这些批注 ', draftRev: 12, phase: 'plain'}) },
    insertReference(ref, span) { captured = { ref, span }; return true },
    setDraft() { throw Error('must not replace draft') } }
  const ctx = { get(name) {
    if (name === 'sessions') return { scope: id => id === 's1' ? actx : undefined }
    if (name === 'conversation') return { input: { for: scope => { assert.equal(scope, actx); return input } } }
  } }
  const saved = { count: 2, relativePath: '.dsh\\\\annotations\\\\2026-11-15-1234\\\\2条批注.md' }
  assert.equal(client.insertAnnotationReference(ctx, 's1', saved), true)
  assert.equal(captured.ref.label, '2 条批注')
  assert.equal(captured.ref.appearance, 'file')
  assert.equal(captured.ref.ref, '@".dsh/annotations/2026-11-15-1234/2条批注.md"')
  assert.equal(captured.span.draftRev, 12)
  assert.equal(captured.span.start, '解释这些批注 '.length)
  assert.equal(client.insertAnnotationReference(ctx, 'missing', saved), false)
  input.insertReference = () => false
  assert.equal(client.insertAnnotationReference(ctx, 's1', saved), false)
  for (const path of ['../x.md', '.dsh/annotations/../x.md', '.dsh/annotations/x"y.md', '.dsh/annotations/x\\ny.md']) {
    assert.equal(client.insertAnnotationReference(ctx, 's1', { ...saved, relativePath: path }), false)
  }
})

test('questions and empty comments have no blanket edit instruction', () => {
  const text = client.buildPrompt({path: 'C:/项目/docs/a.html', notes:[{number:1,kind:'element',selector:'h2',text:'页面原文',comment:'哦',styles:[],hasShot:false}],t})
  assert.match(text, /批注：哦/)
  assert.match(text, /意图不明确时先确认/)
  assert.doesNotMatch(text, /请根据以下页面批注修改|附图：/)
})

test('images are serialized for storage, failed or oversized captures remain honest', async () => {
  const notes = [
    { number:1, shot:Promise.resolve(new Blob(['PNG fixture'], {type:'image/png'})) },
    { number:2, shot:Promise.reject(Error('capture failed')) },
    { number:3, shot:Promise.resolve({size:9*1024*1024}) },
  ]
  const images = await client.collectImages(notes)
  assert.equal(images.length, 1)
  assert.equal(images[0].number, 1)
  assert.equal(Buffer.from(images[0].data,'base64').toString(), 'PNG fixture')
  assert.deepEqual(notes.map(n=>n.hasShot), [true,false,false])
})

`+s.slice(b);
fs.writeFileSync(file,s);
