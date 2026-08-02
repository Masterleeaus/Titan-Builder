import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createWorkspaceServer as createWorkspaceServerImplementation,
  startWorkspaceServer as startWorkspaceServerImplementation,
  type WorkspaceServerOptions,
} from './bridge-server.js';

export {
  buildRipgrepArguments,
  createZipBuffer,
  normalizeExportName,
  normalizeRelativePath,
  resolveProjectPath,
} from './bridge-server.js';
export type { WorkspaceServerOptions } from './bridge-server.js';

function normalizeWorkspaceServerOptions(
  options: WorkspaceServerOptions,
): WorkspaceServerOptions {
  const configuredBridgeToken = options.bridgeToken ?? process.env.BRIDGE_TOKEN;
  return {
    ...options,
    bridgeToken: configuredBridgeToken?.trim(),
  };
}

export async function createWorkspaceServer(
  options: WorkspaceServerOptions = {},
) {
  return createWorkspaceServerImplementation(normalizeWorkspaceServerOptions(options));
}

export async function startWorkspaceServer(
  options: WorkspaceServerOptions = {},
): Promise<void> {
  return startWorkspaceServerImplementation(normalizeWorkspaceServerOptions(options));
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (invokedDirectly) {
  startWorkspaceServer().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
