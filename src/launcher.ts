#!/usr/bin/env node
import { Command } from 'commander';
import { registerServiceCommands } from './service/service-cli.js';

if (process.argv[2] === 'service') {
  const program = new Command()
    .name('openbrowser')
    .description('Local CLI agent for browser-based AI coding assistants');
  registerServiceCommands(program);
  await program.parseAsync();
} else {
  await import('./index.js');
}
