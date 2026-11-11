import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { extractPackages, workspace } from './extract-test-runtime.mjs';

// Same isolated, read-only ASAR extraction as dsh-side-branch; no profile or GUI access.
const packages = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-persistence-jsonl', '@deepseek-ai/dsh-session-turn-outline', '@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-storage-json', '@deepseek-ai/dsh-user-questions', '@deepseek-ai/dsh-scope'];
// Shipped from DSH 0.2.2; 0.2.1 runs tools without a separate executor plugin.
const optionalPackages = ['@deepseek-ai/dsh-tool-executor-native'];
const extraction = extractPackages(packages, optionalPackages);
console.log(`Installed runtime: extracted ${extraction.packages.length} package dependencies (${(extraction.byteCount / 1024 / 1024).toFixed(1)} MiB) into scripts/.runtime.${extraction.optionalMissing.length ? ` Not in this DSH release: ${extraction.optionalMissing.join(', ')}.` : ''}`);
const testHome = path.join(workspace, 'tests', '.integration-data', 'test-home');
fs.mkdirSync(testHome, { recursive: true });
const files = fs.readdirSync(path.join(workspace, 'tests')).filter(name => /^integration-.*\.test\.mjs$/.test(name)).map(name => path.join(workspace, 'tests', name));
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], { cwd: workspace, stdio: 'inherit', env: { ...process.env, DSH_HOME: testHome } });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
