const MAX_ENVIRONMENT_GRANTS = 32;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const BASELINE_ENVIRONMENT_NAMES = new Set([
  'APPDATA',
  'CI',
  'COLORTERM',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMSPEC',
  'COREPACK_HOME',
  'FORCE_COLOR',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LOCALAPPDATA',
  'LOGNAME',
  'NO_COLOR',
  'NPM_CONFIG_CACHE',
  'PATH',
  'PATHEXT',
  'PNPM_HOME',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'SHELL',
  'SYSTEMROOT',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'TZ',
  'USER',
  'USERPROFILE',
  'WINDIR',
]);

const PROCESS_INJECTION_NAMES = new Set([
  'BASH_ENV',
  'ENV',
  'LD_AUDIT',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'NODE_OPTIONS',
  'NODE_PATH',
  'PERL5OPT',
  'PROMPT_COMMAND',
  'PS4',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'RUBYOPT',
  'SHELLOPTS',
  'ZDOTDIR',
]);

const SECRET_AUTHORITY_PREFIXES = [
  'ANTHROPIC_',
  'AWS_',
  'AZURE_',
  'BRIDGE_',
  'GEMINI_',
  'GH_',
  'GITHUB_',
  'GOOGLE_API_',
  'OPENAI_',
  'OPENBROWSER_',
  'TITAN_',
  'WORKSPACE_',
] as const;

const SENSITIVE_NAME_PATTERN = /(?:^|_)(?:ACCESS_KEY|APIKEY|API_KEY|AUTH|BEARER|CLIENT_SECRET|COOKIE|CREDENTIAL|PASSWORD|PASSWD|PRIVATE_KEY|SECRET|SESSION|TOKEN)(?:$|_)/iu;
const PACKAGE_AUTH_PATTERN = /(?:_AUTH|AUTHTOKEN|AUTH_TOKEN|AUTHORIZATION|NPM_TOKEN|NODE_AUTH_TOKEN|REGISTRY.*TOKEN)/iu;

export interface RepositoryChildEnvironment {
  env: NodeJS.ProcessEnv;
  redactions: readonly string[];
}

export function validateEnvironmentGrants(names: readonly string[] = []): string[] {
  if (names.length > MAX_ENVIRONMENT_GRANTS) {
    throw new Error(`At most ${MAX_ENVIRONMENT_GRANTS} environment variable grants are allowed`);
  }

  const grants = new Set<string>();
  for (const rawName of names) {
    const name = rawName.trim();
    if (isBlockedEnvironmentName(name)) {
      throw new Error(`Environment variable ${name || '<empty>'} cannot be granted to repository code`);
    }
    if (!ENVIRONMENT_NAME_PATTERN.test(name)) {
      throw new Error(`${name || '<empty>'} is not a valid environment variable name`);
    }
    grants.add(name);
  }

  return [...grants].sort((left, right) => left.localeCompare(right));
}

export function formatEnvironmentGrantPreview(names: readonly string[] = []): string {
  const grants = validateEnvironmentGrants(names);
  return grants.length > 0 ? grants.join(', ') : 'baseline only';
}

export function buildRepositoryChildEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  requestedGrants: readonly string[] = [],
): RepositoryChildEnvironment {
  const grants = validateEnvironmentGrants(requestedGrants);
  const grantNames = new Set(grants.map(canonicalEnvironmentName));
  const env: NodeJS.ProcessEnv = {};
  const redactions = new Set<string>();

  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const canonicalName = canonicalEnvironmentName(name);

    if (isSensitiveEnvironmentName(name) && value.length >= 4) {
      addRedactionVariants(redactions, value);
    }

    if (isBlockedEnvironmentName(name)) continue;
    if (isBaselineEnvironmentName(canonicalName) || grantNames.has(canonicalName)) {
      env[name] = value;
    }
  }

  return {
    env,
    redactions: Object.freeze([...redactions].sort((left, right) => right.length - left.length)),
  };
}

export function redactChildOutput(
  text: string,
  redactions: readonly string[],
): string {
  let redacted = text;
  for (const value of [...new Set(redactions)].sort((left, right) => right.length - left.length)) {
    if (!value) continue;
    redacted = redacted.split(value).join('[REDACTED]');
  }
  return redacted;
}

export function isBlockedEnvironmentName(name: string): boolean {
  const canonicalName = canonicalEnvironmentName(name);
  if (!canonicalName) return false;
  if (PROCESS_INJECTION_NAMES.has(canonicalName)) return true;
  if (canonicalName.startsWith('DYLD_')) return true;
  if (SECRET_AUTHORITY_PREFIXES.some((prefix) => canonicalName.startsWith(prefix))) return true;
  return isSensitiveEnvironmentName(canonicalName);
}

function isBaselineEnvironmentName(canonicalName: string): boolean {
  return BASELINE_ENVIRONMENT_NAMES.has(canonicalName) || canonicalName.startsWith('LC_');
}

function isSensitiveEnvironmentName(name: string): boolean {
  const canonicalName = canonicalEnvironmentName(name);
  return SENSITIVE_NAME_PATTERN.test(canonicalName)
    || PACKAGE_AUTH_PATTERN.test(canonicalName)
    || SECRET_AUTHORITY_PREFIXES.some((prefix) => canonicalName.startsWith(prefix));
}

function canonicalEnvironmentName(name: string): string {
  return name.trim().toUpperCase();
}

function addRedactionVariants(target: Set<string>, value: string): void {
  target.add(value);
  const encoded = encodeURIComponent(value);
  if (encoded !== value) target.add(encoded);
  const base64 = Buffer.from(value, 'utf8').toString('base64');
  if (base64.length >= 8) target.add(base64);
}
