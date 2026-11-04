// Only top-level fenced code blocks are intercepted. All other Markdown stays native.
const DIAGRAM_START = /^(?:flowchart\s+(?:TB|TD|BT|RL|LR)\b|graph\s+(?:TB|TD|BT|RL|LR)\b|sequenceDiagram\b|classDiagram\b|stateDiagram(?:-v2)?\b|erDiagram\b|gantt\b|pie\b|journey\b|gitGraph\b|mindmap\b|timeline\b|quadrantChart\b|xychart(?:-beta)?\b|sankey-beta\b|block(?:-beta)?\b|packet(?:-beta)?\b|architecture-beta\b|kanban\b|requirementDiagram\b|C4(?:Context|Container|Component|Dynamic|Deployment)\b)/;

export function looksLikeMermaid(source) {
  const first = source.split(/\r?\n/).map(s => s.trim()).find(s => s && !s.startsWith('%%'));
  return !!first && DIAGRAM_START.test(first);
}

export function splitDiagrams(text) {
  if (typeof text !== 'string') return [];
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const result = [];
  let offset = 0, cursor = 0;
  for (let i = 0; i < lines.length; i++) {
    const opening = lines[i].match(/^(`{3,}|~{3,})([^\r\n]*)\r?\n?$/);
    if (!opening || (opening[1][0] === '`' && opening[2].includes('`'))) {
      offset += lines[i].length;
      continue;
    }
    const start = offset, marker = opening[1][0], length = opening[1].length;
    const language = opening[2].trim().toLowerCase();
    const closing = new RegExp(`^ {0,3}${marker}{${length},}[ \\t]*\\r?\\n?$`);
    let body = '', end = offset + lines[i].length, j = i + 1;
    for (; j < lines.length; j++) {
      end += lines[j].length;
      if (closing.test(lines[j])) break;
      body += lines[j];
    }
    // Incomplete blocks remain source until the closing fence arrives.
    if (j === lines.length) break;
    if (language === 'mermaid' || (language === '' && looksLikeMermaid(body))) {
      if (start > cursor) result.push({ kind: 'native', text: text.slice(cursor, start), start: cursor });
      result.push({ kind: 'diagram', source: body.replace(/\r?\n$/, ''), raw: text.slice(start, end), start });
      cursor = end;
    }
    i = j;
    offset = end;
  }
  if (cursor < text.length || !result.length) result.push({ kind: 'native', text: text.slice(cursor), start: cursor });
  return result;
}

// Preserve reference links and footnote definitions when native Markdown is split.
export function referenceDefinitions(text) {
  const lines = text.split(/\r?\n/);
  const definitions = [];
  let fenced = null;
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (!fenced) fenced = fence[1];
      else if (fence[1][0] === fenced[0] && fence[1].length >= fenced.length) fenced = null;
      continue;
    }
    if (fenced || !/^ {0,3}\[[^\]]+\]:\s*\S/.test(lines[i])) continue;
    let definition = lines[i];
    while (i + 1 < lines.length && /^(?: {4}|\t)\S/.test(lines[i + 1])) definition += '\n' + lines[++i];
    definitions.push(definition);
  }
  return definitions.length ? '\n\n' + definitions.join('\n') : '';
}

export function diagramType(source) {
  const first = source.split(/\r?\n/).map(s => s.trim()).find(s => s && !s.startsWith('%%')) || '';
  return first.split(/\s/)[0] || 'Mermaid';
}

export function validateSource(source) {
  if (source.length > 30000) throw new Error('sourceTooLarge');
  // Prevent message-authored configuration from overriding renderer isolation.
  if (/^\s*---(?:\r?\n|$)/.test(source) || /%%\s*\{/.test(source)) throw new Error('customConfig');
  if (/@import\b|url\s*\(|<(?:img|image)\b|\b(?:img|image)\s*:/i.test(source)) throw new Error('externalStyle');
}
