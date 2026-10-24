import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { extractPackages, runtimeDir, workspace } from './extract-test-runtime.mjs';

const packages = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-persistence-jsonl', '@deepseek-ai/dsh-session-turn-outline', '@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-storage-json', '@deepseek-ai/dsh-client-modules', '@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-web-frontend'];
const extraction = extractPackages(packages);
console.log(`Installed runtime: extracted ${extraction.packages.length} package dependencies (${(extraction.byteCount / 1024 / 1024).toFixed(1)} MiB) into scripts/.runtime.`);
console.log('Tests use workspace persistence, an in-process fake LLM, and guards against sockets, networking, and subprocess execution.');
const testHome = path.join(workspace, 'tests', '.integration-data', 'test-home');
fs.mkdirSync(testHome, { recursive: true });
const files = fs.readdirSync(path.join(workspace, 'tests')).filter(name => /^integration-.*\.test\.mjs$/.test(name)).map(name => path.join(workspace, 'tests', name));
const child = spawn(process.execPath, ['--test', ...files], { cwd: workspace, stdio: 'inherit', env: { ...process.env, DSH_HOME: testHome } });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
