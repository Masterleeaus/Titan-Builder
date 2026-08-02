import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LoadWorkspaceEnvironmentOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  packageRoot?: string;
}

export function parseEnvironmentText(text: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const sourceLine of text.split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const normalized = line.startsWith('export ') ? line.slice(7).trimStart() : line;
    const separator = normalized.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = normalized.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      continue;
    }

    values[key] = unquote(normalized.slice(separator + 1).trim());
  }

  return values;
}

export function loadWorkspaceEnvironment(
  options: LoadWorkspaceEnvironmentOptions = {},
): string | undefined {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const packageRoot = options.packageRoot ?? resolvePackageRoot();
  const candidates = [
    env.OPENBROWSER_CONFIG,
    path.join(homeDir, '.openbrowser', '.env'),
    path.join(packageRoot, '.env'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const configPath = candidates.find((candidate) => existsSync(candidate));
  if (!configPath) {
    return undefined;
  }

  const values = parseEnvironmentText(readFileSync(configPath, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (env[key] === undefined) {
      env[key] = value;
    }
  }

  return configPath;
}

function resolvePackageRoot(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.at(-1) === quote) {
      return value.slice(1, -1);
    }
  }

  return value;
}
