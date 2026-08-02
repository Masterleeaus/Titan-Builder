import { stdout as output } from 'node:process';
import type { Command } from 'commander';
import { createServiceManager } from './service-manager.js';

export function registerServiceCommands(program: Command): void {
  const service = program
    .command('service')
    .description('Manage the detached local OpenBrowser bridge service');

  service.command('start').description('Start the local bridge in the background').action(async () => {
    const status = await createServiceManager().start();
    if (status.alreadyRunning) {
      output.write(`OpenBrowser service is already running (PID ${status.pid}).\n`);
      return;
    }
    output.write(`OpenBrowser service started (PID ${status.pid}).\n`);
    output.write(`Logs: ${status.logPath}\n`);
  });

  service.command('status').description('Show background service status').action(async () => {
    const status = await createServiceManager().status();
    if (status.status === 'running') {
      output.write(`OpenBrowser service is running (PID ${status.pid}).\n`);
      output.write(`Started: ${status.startedAt}\nLogs: ${status.logPath}\n`);
      return;
    }
    output.write('OpenBrowser service is stopped.\n');
    if (status.staleMetadata) output.write('Removed stale service metadata.\n');
  });

  service.command('stop').description('Stop the local background bridge').action(async () => {
    await createServiceManager().stop();
    output.write('OpenBrowser service stopped.\n');
  });

  service
    .command('logs')
    .description('Print recent service logs')
    .option('-n, --lines <count>', 'number of lines', parseLineCount, 100)
    .action(async (options: { lines: number }) => {
      const text = await createServiceManager().logs(options.lines);
      output.write(text ? `${text}\n` : 'No service logs yet.\n');
    });
}

function parseLineCount(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5000) {
    throw new Error('Log lines must be an integer between 1 and 5000');
  }
  return parsed;
}
