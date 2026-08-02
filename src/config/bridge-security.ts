import crypto from 'node:crypto';
import { access, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface EnsureBridgeSecurityOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  configPath?: string;
}

export interface BridgeSecurityEnvironmentResult {
  configPath: string;
  generatedControlToken: boolean;
  generatedBrowserToken: boolean;
  insecureDevelopment: boolean;
}

const MIN_TOKEN_CHARACTERS = 32;

export async function ensureBridgeSecurityEnvironment(
  options: EnsureBridgeSecurityOptions = {},
): Promise<BridgeSecurityEnvironmentResult> {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const configPath = options.configPath ?? env.OPENBROWSER_CONFIG ?? path.join(homeDir, '.openbrowser', '.env');
  const insecureDevelopment = env.OPENBROWSER_INSECURE_DEV === '1';

  if (insecureDevelopment) {
    return {
      configPath,
      generatedControlToken: false,
      generatedBrowserToken: false,
      insecureDevelopment: true,
    };
  }

  let existingText = '';
  try {
    existingText = await readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const fileValues = parseEnvironmentText(existingText);
  for (const key of ['BRIDGE_TOKEN', 'BRIDGE_BROWSER_TOKEN'] as const) {
    if (env[key] === undefined && fileValues[key]) {
      env[key] = fileValues[key];
    }
  }

  let generatedControlToken = false;
  let generatedBrowserToken = false;
  if (!env.BRIDGE_TOKEN?.trim()) {
    env.BRIDGE_TOKEN = generateStrongToken();
    generatedControlToken = true;
  }
  if (!env.BRIDGE_BROWSER_TOKEN?.trim()) {
    env.BRIDGE_BROWSER_TOKEN = generateStrongToken();
    generatedBrowserToken = true;
  }

  assertStrongToken(env.BRIDGE_TOKEN, 'Control');
  assertStrongToken(env.BRIDGE_BROWSER_TOKEN, 'Browser');
  if (env.BRIDGE_TOKEN === env.BRIDGE_BROWSER_TOKEN) {
    throw new Error('Control and browser tokens must be different');
  }

  if (generatedControlToken || generatedBrowserToken) {
    await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
    const lines: string[] = [];
    const trimmed = existingText.trimEnd();
    if (trimmed) {
      lines.push(trimmed);
    }
    if (generatedControlToken) {
      lines.push(`BRIDGE_TOKEN=${env.BRIDGE_TOKEN}`);
    }
    if (generatedBrowserToken) {
      lines.push(`BRIDGE_BROWSER_TOKEN=${env.BRIDGE_BROWSER_TOKEN}`);
    }
    const temporaryPath = `${configPath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, configPath);
    if (process.platform !== 'win32') {
      await chmod(configPath, 0o600);
    }
  } else {
    await access(configPath).catch(() => undefined);
  }

  return {
    configPath,
    generatedControlToken,
    generatedBrowserToken,
    insecureDevelopment: false,
  };
}

export function generateStrongToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

function assertStrongToken(token: string | undefined, label: string): void {
  const normalized = token?.trim() ?? '';
  if (!normalized) {
    throw new Error(`${label} token is required`);
  }
  if (normalized.length < MIN_TOKEN_CHARACTERS) {
    throw new Error(`${label} token must be at least ${MIN_TOKEN_CHARACTERS} characters`);
  }
}

function parseEnvironmentText(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) values[key] = value;
  }
  return values;
}
