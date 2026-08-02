import { loadOpenBrowserEnvironment } from '../config/environment.js';
import { logger } from '../shared/index.js';
import { startServer } from '../server/index.js';

loadOpenBrowserEnvironment();

const server = await startServer();
let closing = false;

async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'OpenBrowser service stopping');
  try {
    await server.close();
    process.exitCode = 0;
  } catch (error) {
    logger.error(error, 'OpenBrowser service shutdown failed');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  logger.error(error, 'OpenBrowser service uncaught exception');
  void shutdown('uncaughtException');
});
process.on('unhandledRejection', (error) => {
  logger.error(error, 'OpenBrowser service unhandled rejection');
  void shutdown('unhandledRejection');
});

logger.info({ pid: process.pid }, 'OpenBrowser background service ready');
