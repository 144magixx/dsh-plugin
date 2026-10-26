import { spawn } from 'node:child_process';
import path from 'node:path';
import { extractPackages, workspace } from './extract-test-runtime.mjs';
const result = extractPackages(['@deepseek-ai/cordis', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-query', '@deepseek-ai/dsh-session-persistence-jsonl', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-storage-json', '@deepseek-ai/dsh-workspace']);
console.log(`Using ${result.packages.length} packages from installed DSH; test data is isolated under tests/.integration-data.`);
const child = spawn(process.execPath, ['--test', path.join(workspace, 'tests/integration.test.mjs')], { cwd: workspace, stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
