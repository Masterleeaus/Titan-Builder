import { spawn } from 'node:child_process';

const implementationPath = import.meta.url.endsWith('.ts')
  ? './hardened-read.ts'
  : './hardened-read.js';
const { createHardenedGitEnvironment } = await import(implementationPath);

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write('Hardened Git runner requires a command.\n');
  process.exitCode = 2;
} else {
  const child = spawn('git', args, {
    env: createHardenedGitEnvironment(process.env),
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
