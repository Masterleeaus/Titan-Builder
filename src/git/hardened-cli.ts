import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const implementationPath = path.extname(modulePath) === '.ts'
  ? './hardened-read.ts'
  : './hardened-read.js';
const { buildHardenedGitInvocation } = await import(implementationPath);

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write('Hardened Git runner requires a command.\n');
  process.exitCode = 2;
} else {
  const invocation = buildHardenedGitInvocation(args, process.env);
  const child = spawn(invocation.executable, invocation.args, {
    env: invocation.env,
    shell: false,
    windowsHide: true,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    process.stderr.write(`Failed to start hardened Git: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}
