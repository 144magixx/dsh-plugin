import { createHash } from 'node:crypto';

export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : stable(value)).digest('hex');
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** All displayed prose passes this boundary. Configuration objects never do. */
export function safeText(value, max = 12000) {
  if (typeof value !== 'string') return '';
  return value.slice(0, Math.max(max * 3, 4096))
    .replace(/-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?(?:-----END [^-]+-----|$)/gi, '[REDACTED]')
    .replace(/\bhttps?:\/\/[^\s<>"')]+/gi, raw => {
      try { const url = new URL(raw); if (url.username || url.password || url.search || url.hash) return `${url.protocol}//${url.host}${url.pathname} [REDACTED]`; } catch {}
      return raw;
    })
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_.=-]+/gi, '$1 [REDACTED]')
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/((?:["']?)(?:[\w.-]*(?:token|password|passwd|secret|api[_-]?key|cookie|authorization|credential)[\w.-]*)(?:["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}\n]+)/gi, '$1[REDACTED]')
    .replace(/((?:--)(?:token|password|secret|api-key|cookie|authorization)\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1[REDACTED]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, max);
}

export function skillMetadata(raw, fallback) {
  const front = /^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  const values = {};
  if (front) {
    const lines = front[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const match = /^(name|description):\s*(.*)$/.exec(lines[i]);
      if (!match) continue;
      let val = match[2].trim();
      if (/^[>|][-+]?\s*$/.test(val)) {
        const block = [];
        while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i].trim());
        val = block.join(' ');
      } else if (val.startsWith('"')) { try { val = JSON.parse(val); } catch { val = val.replace(/^"|"$/g, ''); } }
      else val = val.replace(/^'|'$/g, '').replace(/''/g, "'").replace(/\s+#.*$/, '');
      values[match[1]] = val;
    }
  }
  return { name: safeText(values.name || fallback, 160), description: safeText(values.description || '本地 Skill；使用前请读取完整说明。', 700), body: safeText(front ? raw.slice(front[0].length) : raw, 12000), truncated: raw.length > 12000 };
}

function stripComment(line) {
  let quoted = '', escape = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (escape) { escape = false; continue; }
    if (quoted === '"' && c === '\\') { escape = true; continue; }
    if (quoted) { if (c === quoted) quoted = ''; continue; }
    if (c === '"' || c === "'") { quoted = c; continue; }
    if (c === '#') return line.slice(0, i);
  }
  return line;
}
function tableParts(text) {
  const parts = []; let at = 0;
  while (at < text.length) {
    const found = /^\s*(?:"((?:\\.|[^"\\])*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*(\.|$)/.exec(text.slice(at));
    if (!found) return null;
    let part = found[1] === undefined ? found[2] ?? found[3] : JSON.parse(`"${found[1]}"`);
    parts.push(part); at += found[0].length;
  }
  return parts;
}
function scalar(raw) {
  raw = raw.trim();
  if (raw === 'true' || raw === 'false') return raw === 'true';
  if (/^'(?:[^']*)'$/.test(raw)) return raw.slice(1, -1);
  if (raw.startsWith('"') && raw.endsWith('"')) { try { return JSON.parse(raw); } catch {} }
  return undefined;
}
/** Bounded MCP-table reader, deliberately not a general TOML evaluator. It never evaluates includes or expressions. */
export function parseCodexMcp(raw) {
  const servers = new Map(); let current; let table = []; let unsupported = false;
  for (const original of raw.split(/\r?\n/)) {
    const line = stripComment(original).trim();
    if (!line) continue;
    if (line.startsWith('[')) {
      const match = /^\[([^\]]+)\]$/.exec(line);
      try { table = match ? tableParts(match[1]) ?? [] : []; } catch { table = []; }
      current = table[0] === 'mcp_servers' && table.length >= 2 ? table[1] : undefined;
      if (current && !servers.has(current)) servers.set(current, { _raw: '' });
      if (line.includes('mcp_servers') && !current) unsupported = true;
      continue;
    }
    if (!current) continue;
    const server = servers.get(current); server._raw += `${table.join('.')}\n${line}\n`;
    if (table.length !== 2) continue;
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    if (!match) { unsupported = true; continue; }
    const value = scalar(match[2]);
    if (['command', 'url', 'transport', 'type', 'enabled', 'disabled'].includes(match[1])) {
      if (value === undefined) unsupported = true;
      else server[match[1]] = value;
    }
  }
  return { servers: [...servers].map(([name, config]) => ({ name, config })), unsupported };
}

export function jsonMcpEntries(value, cwd) {
  const result = [];
  function add(mapping) {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return;
    for (const [name, config] of Object.entries(mapping)) if (config && typeof config === 'object' && !Array.isArray(config)) result.push({ name, config });
  }
  add(value?.mcpServers); add(value?.mcp_servers);
  const project = cwd ? value?.projects?.[cwd] : undefined;
  add(project?.mcpServers);
  const disabled = new Set([...(Array.isArray(value?.disabledMcpServers) ? value.disabledMcpServers : []), ...(Array.isArray(project?.disabledMcpServers) ? project.disabledMcpServers : [])]);
  return result.map(row => disabled.has(row.name) ? { ...row, config: { ...row.config, disabled: true } } : row);
}

export function mcpSummary(name, config) {
  const transport = config.transport === 'stdio' || typeof config.command === 'string' ? 'stdio' : typeof config.url === 'string' || ['http', 'sse', 'streamable-http'].includes(config.transport ?? config.type) ? 'http' : 'unknown';
  return { name: safeText(name, 160), transport, status: config.enabled === false || config.disabled === true ? 'disabled' : 'configured', fingerprint: hash(config) };
}
