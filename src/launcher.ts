#!/usr/bin/env node
import { Command } from 'commander';
import { registerDoctorCommand } from './diagnostics/doctor-cli.js';
import { registerServiceCommands } from './service/service-cli.js';

if (process.argv[2] === 'service' || process.argv[2] === 'doctor') {
  const program = new Command()
    .name('openbrowser')
    .description('Local CLI agent for browser-based AI coding assistants');
  registerServiceCommands(program);
  registerDoctorCommand(program);
  await program.parseAsync();
} else {
  await import('./index.js');
}
