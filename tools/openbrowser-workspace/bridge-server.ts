import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import chokidar from 'chokidar';
import { config } from 'dotenv';
import fg from 'fast-glob';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';
import yazl from 'yazl';
import { z } from 'zod';

config();

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5010;
const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:5000';
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const MAX_INDEX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_CONTEXT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PROCESS_BUFFER_BYTES = 20 * 1024 * 1024;
const DEFAULT_IGNORE = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/*.log',
  '**/*.tmp',
];

type SqliteDatabase = InstanceType<typeof Database>;

type ProjectRow = {
  id: string;
  name: string;
  root: string;
  branch: string | null;
  remote: string | null;
  package_manager: string;
  created_at: string;
  updated_at: string;
};

type IndexedFile = {
  path: string;
  hash: string;
  size: number;
  lastModified: string;
};

type ExportFile = {
  name: string;
  content: string;
};

export interface WorkspaceServerOptions {
  host?: string;
  port?: number;
  databasePath?: string;
  workspaceToken?: string;
  bridgeToken?: string;
  bridgeUrl?: string;
}

class WorkspaceHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'WorkspaceHttpError';
  }
}

const RegisterProjectSchema = z.object({
  root: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200).optional(),
});

const ActivateProjectSchema = z.object({
  projectId: z.string().trim().min(1),
});

const ContextPreviewSchema = z.object({
  refs: z.array(z.string().trim().min(1)).min(1).max(100).default(['.']),
  totalCharacters: z.number().int().positive().max(2_000_000).default(60_000),
  perFileCharacters: z.number().int().positive().max(500_000).default(24_000),
  maxFiles: z.number().int().positive().max(500).default(30),
});

const SearchSchema = z.object({
  pattern: z.string().min(1).max(2_000),
  path: z.string().min(1).default('.'),
  regex: z.boolean().default(false),
});

const FilePathSchema = z.object({
  path: z.string().trim().min(1),
});

const StagedAnalysisSchema = z.object({
  files: z.array(z.string().trim().min(1)).min(1).max(500),
});

const ExportSchema = z.object({
  files: z.array(z.object({
    name: z.string().trim().min(1).max(1_000),
    content: z.string(),
  })).min(1).max(500),
});

const PromptSchema = z.object({
  prompt: z.string().trim().min(1).max(5_000_000),
  mode: z.enum(['ask', 'agent']).default('ask'),
  systemPrompt: z.string().trim().min(1).max(200_000).optional(),
  conversationId: z.string().trim().min(1).optional(),
});

const ReviewSchema = z.object({
  diff: z.string().min(1).max(5_000_000),
});

const PullRequestAnalysisSchema = ReviewSchema.extend({
  prNumber: z.number().int().positive().optional(),
});

function tokenMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function readBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

export function normalizeRelativePath(value: string): string {
  if (value.includes('\0')) {
    throw new WorkspaceHttpError('Path contains a null byte', 400);
  }

  const portable = value.replaceAll('\\', '/');
  if (path.posix.isAbsolute(portable) || /^[A-Za-z]:\//.test(portable)) {
    throw new WorkspaceHttpError('Absolute paths are not allowed', 400);
  }

  const normalized = path.posix.normalize(portable);
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new WorkspaceHttpError('Path traversal is not allowed', 403);
  }

  return normalized.replace(/^\.\//, '') || '.';
}

export function normalizeExportName(value: string): string {
  const normalized = normalizeRelativePath(value);
  if (normalized === '.' || normalized.endsWith('/')) {
    throw new WorkspaceHttpError('Export file name must identify a file', 400);
  }
  return normalized;
}

async function canonicalizeProjectRoot(root: string): Promise<string> {
  const requested = path.resolve(root);
  const requestedStat = await fs.lstat(requested).catch(() => undefined);
  if (!requestedStat?.isDirectory()) {
    throw new WorkspaceHttpError('Project root must be an existing directory', 400);
  }
  if (requestedStat.isSymbolicLink()) {
    throw new WorkspaceHttpError('Symbolic-link project roots are not allowed', 403);
  }
  return fs.realpath(requested);
}

async function assertNoSymlinkSegments(root: string, candidate: string): Promise<void> {
  const relative = path.relative(root, candidate);
  if (!relative) return;

  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch(() => undefined);
    if (!stat) {
      throw new WorkspaceHttpError(`Path does not exist: ${relative}`, 404);
    }
    if (stat.isSymbolicLink()) {
      throw new WorkspaceHttpError(`Symbolic-link path segment is not allowed: ${segment}`, 403);
    }
  }
}

export async function resolveProjectPath(root: string, requestedPath: string): Promise<string> {
  const canonicalRoot = await canonicalizeProjectRoot(root);
  const normalized = normalizeRelativePath(requestedPath);
  const candidate = path.resolve(canonicalRoot, normalized);
  const prefix = `${canonicalRoot}${path.sep}`;
  if (candidate !== canonicalRoot && !candidate.startsWith(prefix)) {
    throw new WorkspaceHttpError('Requested path escapes the active project', 403);
  }

  await assertNoSymlinkSegments(canonicalRoot, candidate);
  const realCandidate = await fs.realpath(candidate);
  if (realCandidate !== canonicalRoot && !realCandidate.startsWith(prefix)) {
    throw new WorkspaceHttpError('Resolved path escapes the active project', 403);
  }
  return realCandidate;
}

export function buildRipgrepArguments(pattern: string, relativePath: string, regex: boolean): string[] {
  const args = [
    '--json',
    '--ignore-case',
    '--line-number',
    '--column',
    '--max-count',
    '500',
  ];
  if (!regex) args.push('--fixed-strings');
  args.push('--', pattern, relativePath);
  return args;
}

function runProcess(
  executable: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 60_000,
      maxBuffer: options.maxBuffer ?? MAX_PROCESS_BUFFER_BYTES,
      windowsHide: true,
      shell: false,
    }, (error, stdout, stderr) => {
      if (error) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function readCommandOutput(executable: string, args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await runProcess(executable, args, { cwd, timeoutMs: 10_000 });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

async function detectPackageManager(root: string): Promise<string> {
  const candidates: Array<[string, string]> = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['package-lock.json', 'npm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
  ];
  for (const [fileName, manager] of candidates) {
    try {
      await fs.access(path.join(root, fileName));
      return manager;
    } catch {
      // Continue to the next lockfile.
    }
  }
  return 'unknown';
}

function initializeDatabase(databasePath: string): SqliteDatabase {
  const directory = path.dirname(databasePath);
  const schemaPath = path.join(moduleDirectory, 'schema.sql');
  return new Database(databasePath, { fileMustExist: false });
}

async function applyDatabaseSchema(database: SqliteDatabase, databasePath: string): Promise<void> {
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  database.pragma('cache_size = -20000');
  database.pragma('mmap_size = 268435456');
  database.exec(await fs.readFile(path.join(moduleDirectory, 'schema.sql'), 'utf8'));
}

function getActiveProject(database: SqliteDatabase): ProjectRow | undefined {
  const setting = database.prepare(
    "SELECT value FROM workspace_settings WHERE key = 'active_project_id'",
  ).get() as { value: string } | undefined;

  if (setting) {
    const selected = database.prepare('SELECT * FROM projects WHERE id = ?').get(setting.value) as
      | ProjectRow
      | undefined;
    if (selected) return selected;
  }

  return database.prepare('SELECT * FROM projects ORDER BY updated_at DESC LIMIT 1').get() as
    | ProjectRow
    | undefined;
}

function setActiveProject(database: SqliteDatabase, projectId: string): ProjectRow {
  const project = database.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
    | ProjectRow
    | undefined;
  if (!project) throw new WorkspaceHttpError('Project not found', 404);

  database.prepare(`
    INSERT INTO workspace_settings (key, value)
    VALUES ('active_project_id', ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(projectId);
  return project;
}

function requireActiveProject(database: SqliteDatabase): ProjectRow {
  const project = getActiveProject(database);
  if (!project) throw new WorkspaceHttpError('No active project is registered', 404);
  return project;
}

function projectIdentifier(root: string): string {
  return crypto.createHash('sha256').update(root).digest('hex').slice(0, 24);
}

function beginJob(database: SqliteDatabase, projectId: string | null, kind: string): string {
  const id = crypto.randomUUID();
  database.prepare(`
    INSERT INTO job_history (id, project_id, kind, status)
    VALUES (?, ?, ?, 'running')
  `).run(id, projectId, kind);
  return id;
}

function completeJob(
  database: SqliteDatabase,
  jobId: string,
  metadata: unknown,
): void {
  database.prepare(`
    UPDATE job_history
    SET status = 'complete', completed_at = CURRENT_TIMESTAMP, metadata = ?
    WHERE id = ?
  `).run(JSON.stringify(metadata), jobId);
}

function failJob(database: SqliteDatabase, jobId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  database.prepare(`
    UPDATE job_history
    SET status = 'error', completed_at = CURRENT_TIMESTAMP, error = ?
    WHERE id = ?
  `).run(message, jobId);
}

function isIgnoredPath(filePath: string): boolean {
  const portable = filePath.replaceAll('\\', '/');
  return [
    '/.git/',
    '/node_modules/',
    '/dist/',
    '/build/',
    '/coverage/',
    '/.next/',
    '/.turbo/',
  ].some((segment) => portable.includes(segment));
}

async function hashFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function indexProjectFiles(root: string): Promise<{ files: IndexedFile[]; skipped: number }> {
  const files: IndexedFile[] = [];
  let skipped = 0;
  const pending: Array<Promise<void>> = [];
  const watcher = chokidar.watch(root, {
    ignored: DEFAULT_IGNORE,
    persistent: false,
    ignoreInitial: false,
    followSymlinks: false,
  });

  watcher.on('add', (filePath) => {
    pending.push((async () => {
      try {
        if (isIgnoredPath(filePath)) {
          skipped += 1;
          return;
        }
        const relative = path.relative(root, filePath);
        await resolveProjectPath(root, relative);
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size > MAX_INDEX_FILE_BYTES) {
          skipped += 1;
          return;
        }
        files.push({
          path: relative.replaceAll('\\', '/'),
          hash: await hashFile(filePath),
          size: stat.size,
          lastModified: stat.mtime.toISOString(),
        });
      } catch {
        skipped += 1;
      }
    })());
  });

  await new Promise<void>((resolve, reject) => {
    watcher.once('ready', resolve);
    watcher.once('error', reject);
  });
  await watcher.close();
  await Promise.all(pending);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { files, skipped };
}

function persistIndex(database: SqliteDatabase, projectId: string, files: IndexedFile[]): void {
  const replace = database.transaction((items: IndexedFile[]) => {
    database.prepare('DELETE FROM file_index WHERE project_id = ?').run(projectId);
    const insert = database.prepare(`
      INSERT INTO file_index (project_id, path, hash, size, last_modified)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      insert.run(projectId, item.path, item.hash, item.size, item.lastModified);
    }
  });
  replace(files);
}

function normalizeGlobReference(reference: string): string {
  const normalized = normalizeRelativePath(reference);
  if (normalized === '.') return '**/*';
  return normalized;
}

async function buildContextPreview(
  root: string,
  input: z.infer<typeof ContextPreviewSchema>,
): Promise<unknown> {
  const patterns = input.refs.map(normalizeGlobReference);
  const candidates = await fg(patterns, {
    cwd: root,
    dot: true,
    onlyFiles: true,
    unique: true,
    followSymbolicLinks: false,
    ignore: DEFAULT_IGNORE,
  });

  const included: Array<{
    path: string;
    characters: number;
    originalCharacters: number;
    truncated: boolean;
  }> = [];
  const excluded: Array<{ path: string; reason: string }> = [];
  let totalCharacters = 0;

  for (const relative of candidates.sort().slice(0, input.maxFiles * 4)) {
    if (included.length >= input.maxFiles || totalCharacters >= input.totalCharacters) break;

    try {
      const filePath = await resolveProjectPath(root, relative);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      if (stat.size > MAX_CONTEXT_FILE_BYTES) {
        excluded.push({ path: relative, reason: 'file_too_large' });
        continue;
      }

      const buffer = await fs.readFile(filePath);
      if (buffer.includes(0)) {
        excluded.push({ path: relative, reason: 'binary_file' });
        continue;
      }

      const original = buffer.toString('utf8');
      const remaining = input.totalCharacters - totalCharacters;
      const budget = Math.min(input.perFileCharacters, remaining);
      const content = original.slice(0, budget);
      if (!content.length) break;

      included.push({
        path: relative.replaceAll('\\', '/'),
        characters: content.length,
        originalCharacters: original.length,
        truncated: content.length < original.length,
      });
      totalCharacters += content.length;
    } catch (error) {
      excluded.push({
        path: relative,
        reason: error instanceof Error ? error.message : 'unreadable',
      });
    }
  }

  return {
    projectRoot: root,
    refs: input.refs,
    totalCharacters,
    limitCharacters: input.totalCharacters,
    perFileCharacters: input.perFileCharacters,
    maxFiles: input.maxFiles,
    included,
    excluded,
  };
}

function parseRipgrepOutput(stdout: string): unknown[] {
  const results: unknown[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as {
        type?: string;
        data?: {
          path?: { text?: string };
          line_number?: number;
          lines?: { text?: string };
          submatches?: Array<{ start: number; end: number; match?: { text?: string } }>;
        };
      };
      if (record.type !== 'match' || !record.data) continue;
      results.push({
        path: record.data.path?.text,
        line: record.data.line_number,
        text: record.data.lines?.text?.replace(/\r?\n$/, ''),
        matches: record.data.submatches ?? [],
      });
      if (results.length >= 500) break;
    } catch {
      // Ignore malformed diagnostic lines from external tools.
    }
  }
  return results;
}

async function runPythonAnalysis(root: string, relativeFiles: string[] = []): Promise<unknown> {
  const scriptPath = path.join(moduleDirectory, 'analysis_tools.py');
  const args = [scriptPath, root];
  for (const relative of relativeFiles) args.push('--file', relative);
  const configured = process.env.PYTHON_BIN?.trim();
  const candidates = configured
    ? [configured]
    : process.platform === 'win32'
      ? ['python', 'py']
      : ['python3', 'python'];

  let lastError: unknown;
  for (const executable of candidates) {
    try {
      const actualArgs = executable === 'py' ? ['-3', ...args] : args;
      const { stdout } = await runProcess(executable, actualArgs, {
        cwd: root,
        timeoutMs: 120_000,
      });
      return JSON.parse(stdout) as unknown;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
    }
  }
  throw new WorkspaceHttpError(
    `Python 3 was not found${lastError instanceof Error ? `: ${lastError.message}` : ''}`,
    503,
  );
}

function genericStagedIssues(relativePath: string, content: string): Array<{
  path: string;
  line: number;
  severity: 'high' | 'medium';
  message: string;
}> {
  const checks: Array<{ expression: RegExp; severity: 'high' | 'medium'; message: string }> = [
    { expression: /\beval\s*\(/, severity: 'high', message: 'Dynamic eval execution detected' },
    { expression: /\bnew\s+Function\s*\(/, severity: 'high', message: 'Dynamic Function construction detected' },
    {
      expression: /\b(?:exec|execSync)\s*\([^\n]*[`'"][^\n]*\$\{/,
      severity: 'high',
      message: 'Potential shell-command interpolation detected',
    },
    {
      expression: /rejectUnauthorized\s*:\s*false/,
      severity: 'medium',
      message: 'TLS certificate verification is disabled',
    },
  ];

  const issues: Array<{
    path: string;
    line: number;
    severity: 'high' | 'medium';
    message: string;
  }> = [];
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const check of checks) {
      if (check.expression.test(line)) {
        issues.push({
          path: relativePath,
          line: index + 1,
          severity: check.severity,
          message: check.message,
        });
      }
      check.expression.lastIndex = 0;
    }
  }
  return issues;
}

export async function createZipBuffer(files: ExportFile[]): Promise<Buffer> {
  const seen = new Set<string>();
  let totalBytes = 0;
  const normalized = files.map((file) => {
    const name = normalizeExportName(file.name);
    const key = name.toLocaleLowerCase('en-US');
    if (seen.has(key)) {
      throw new WorkspaceHttpError(`Duplicate export path: ${name}`, 400);
    }
    seen.add(key);
    const content = Buffer.from(file.content, 'utf8');
    totalBytes += content.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new WorkspaceHttpError('Export exceeds the 50 MB limit', 413);
    }
    return { name, content };
  });

  const zip = new yazl.ZipFile();
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    zip.outputStream.once('error', reject);
    zip.outputStream.once('end', () => resolve(Buffer.concat(chunks)));
  });

  for (const file of normalized) {
    zip.addBuffer(file.content, file.name, { compress: true });
  }
  zip.end();
  return output;
}

async function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  for (const client of server.clients) client.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

export async function createWorkspaceServer(
  options: WorkspaceServerOptions = {},
): Promise<FastifyInstance> {
  const host = options.host ?? process.env.WORKSPACE_HOST ?? DEFAULT_HOST;
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('WORKSPACE_HOST must be a loopback host');
  }

  const workspaceToken = options.workspaceToken ?? process.env.WORKSPACE_TOKEN;
  if (!workspaceToken || workspaceToken.length < 24) {
    throw new Error('WORKSPACE_TOKEN must contain at least 24 characters');
  }

  const bridgeUrl = (options.bridgeUrl ?? process.env.OPENBROWSER_BRIDGE_URL ?? DEFAULT_BRIDGE_URL)
    .replace(/\/$/, '');
  const bridgeToken = options.bridgeToken ?? process.env.BRIDGE_TOKEN;
  const databasePath = path.resolve(
    options.databasePath
      ?? process.env.WORKSPACE_DB_PATH
      ?? path.join(moduleDirectory, 'openbrowser-workspace.db'),
  );

  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  const database = initializeDatabase(databasePath);
  await applyDatabaseSchema(database, databasePath);

  const app = Fastify({
    logger: false,
    bodyLimit: MAX_BODY_BYTES,
  });
  const clients = new Set<WebSocket>();
  const websocketServer = new WebSocketServer({ noServer: true });

  function broadcast(data: unknown): void {
    const message = JSON.stringify(data);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    }
  }

  app.server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const token = readBearerToken(request.headers.authorization) ?? url.searchParams.get('token') ?? undefined;
    if (url.pathname !== '/events' || !tokenMatches(token, workspaceToken)) {
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (client) => {
      websocketServer.emit('connection', client, request);
    });
  });

  websocketServer.on('connection', (client) => {
    clients.add(client);
    client.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
    client.once('close', () => clients.delete(client));
  });

  app.addHook('preHandler', async (request, reply) => {
    if (request.method === 'GET' && request.url === '/health') return;
    const token = readBearerToken(request.headers.authorization);
    if (!tokenMatches(token, workspaceToken)) {
      return reply.code(401).send({ error: 'Unauthorized workspace request' });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'Invalid request', details: error.issues });
    }
    if (error instanceof WorkspaceHttpError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? 'Workspace operation failed' : error.message,
      detail: statusCode >= 500 ? error.message : undefined,
    });
  });

  async function bridgeRequest(method: string, route: string, body?: unknown): Promise<unknown> {
    if (!bridgeToken) {
      throw new WorkspaceHttpError('BRIDGE_TOKEN is required for main-bridge operations', 503);
    }
    const response = await fetch(`${bridgeUrl}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${bridgeToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    let payload: unknown = text;
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        // Preserve non-JSON bridge diagnostics.
      }
    }
    if (!response.ok) {
      const message = typeof payload === 'object' && payload && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Bridge returned HTTP ${response.status}`;
      throw new WorkspaceHttpError(message, response.status);
    }
    return payload;
  }

  async function submitPrompt(input: z.infer<typeof PromptSchema>): Promise<unknown> {
    const conversationId = input.conversationId ?? crypto.randomUUID();
    return bridgeRequest('POST', '/session/prompt', {
      mode: input.mode,
      prompt: input.prompt,
      systemPrompt: input.systemPrompt
        ?? 'You are OpenBrowser. Analyze the supplied local-development task accurately and return actionable results.',
      message: input.prompt,
      conversationId,
    });
  }

  app.get('/health', async () => {
    const quickCheck = database.pragma('quick_check', { simple: true });
    return {
      status: quickCheck === 'ok' ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      uptime: process.uptime(),
      database: quickCheck,
      activeProject: getActiveProject(database) ?? null,
      bridgeUrl,
    };
  });

  app.get('/projects', async () => ({
    projects: database.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all(),
    activeProject: getActiveProject(database) ?? null,
  }));

  app.post('/projects/register-current', async (request) => {
    const input = RegisterProjectSchema.parse(request.body);
    const root = await canonicalizeProjectRoot(input.root);
    const id = projectIdentifier(root);
    const name = input.name ?? path.basename(root);
    const [packageManager, branch, remote] = await Promise.all([
      detectPackageManager(root),
      readCommandOutput('git', ['branch', '--show-current'], root),
      readCommandOutput('git', ['remote', 'get-url', 'origin'], root),
    ]);

    database.prepare(`
      INSERT INTO projects (id, name, root, branch, remote, package_manager)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(root) DO UPDATE SET
        name = excluded.name,
        branch = excluded.branch,
        remote = excluded.remote,
        package_manager = excluded.package_manager,
        updated_at = CURRENT_TIMESTAMP
    `).run(id, name, root, branch, remote, packageManager);
    const project = setActiveProject(database, id);
    broadcast({ type: 'project_registered', project });
    return { project };
  });

  app.post('/projects/active', async (request) => {
    const input = ActivateProjectSchema.parse(request.body);
    const project = setActiveProject(database, input.projectId);
    broadcast({ type: 'active_project_changed', project });
    return { project };
  });

  app.get('/project/memory', async () => bridgeRequest('GET', '/project/memory'));
  app.post('/project/memory', async (request) => bridgeRequest('POST', '/project/memory', request.body));
  app.delete('/project/memory/:memoryId', async (request) => {
    const memoryId = encodeURIComponent((request.params as { memoryId: string }).memoryId);
    return bridgeRequest('DELETE', `/project/memory/${memoryId}`);
  });
  app.post('/project/memory/clear', async () => bridgeRequest('POST', '/project/memory/clear', {}));

  app.post('/project/context/preview', async (request) => {
    const input = ContextPreviewSchema.parse(request.body ?? {});
    const project = requireActiveProject(database);
    return buildContextPreview(project.root, input);
  });

  app.post('/project/search', async (request) => {
    const input = SearchSchema.parse(request.body);
    const project = requireActiveProject(database);
    const normalizedPath = normalizeRelativePath(input.path);
    await resolveProjectPath(project.root, normalizedPath);

    try {
      const { stdout } = await runProcess(
        process.env.RG_BIN?.trim() || 'rg',
        buildRipgrepArguments(input.pattern, normalizedPath, input.regex),
        { cwd: project.root, timeoutMs: 30_000, maxBuffer: 10 * 1024 * 1024 },
      );
      return { results: parseRipgrepOutput(stdout) };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException & { code?: string | number }).code;
      if (code === 1 || code === '1') return { results: [] };
      if (code === 'ENOENT') {
        throw new WorkspaceHttpError('ripgrep is not installed or RG_BIN is invalid', 503);
      }
      throw error;
    }
  });

  app.post('/project/index', async () => {
    const project = requireActiveProject(database);
    const jobId = beginJob(database, project.id, 'index');
    broadcast({ type: 'index_started', jobId, projectId: project.id });
    try {
      const result = await indexProjectFiles(project.root);
      persistIndex(database, project.id, result.files);
      const summary = { indexed: result.files.length, skipped: result.skipped };
      completeJob(database, jobId, summary);
      broadcast({ type: 'index_complete', jobId, ...summary });
      return { jobId, ...summary };
    } catch (error) {
      failJob(database, jobId, error);
      broadcast({ type: 'index_error', jobId });
      throw error;
    }
  });

  app.post('/project/analyze', async () => {
    const project = requireActiveProject(database);
    const jobId = beginJob(database, project.id, 'analysis');
    broadcast({ type: 'analysis_started', jobId, projectId: project.id });
    try {
      const analysis = await runPythonAnalysis(project.root);
      completeJob(database, jobId, analysis);
      broadcast({ type: 'analysis_complete', jobId });
      return { jobId, analysis };
    } catch (error) {
      failJob(database, jobId, error);
      broadcast({ type: 'analysis_error', jobId });
      throw error;
    }
  });

  app.post('/project/analyze-file', async (request) => {
    const input = FilePathSchema.parse(request.body);
    const project = requireActiveProject(database);
    const relative = normalizeRelativePath(input.path);
    await resolveProjectPath(project.root, relative);
    return { analysis: await runPythonAnalysis(project.root, [relative]) };
  });

  app.post('/project/analyze-staged', async (request) => {
    const input = StagedAnalysisSchema.parse(request.body);
    const project = requireActiveProject(database);
    const pythonFiles: string[] = [];
    const issues: ReturnType<typeof genericStagedIssues> = [];

    for (const requested of input.files) {
      const relative = normalizeRelativePath(requested);
      const absolute = await resolveProjectPath(project.root, relative);
      const stat = await fs.stat(absolute);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
      if (relative.endsWith('.py')) {
        pythonFiles.push(relative);
        continue;
      }
      if (/\.(?:[cm]?[jt]sx?|json)$/i.test(relative)) {
        const content = await fs.readFile(absolute, 'utf8');
        if (relative.endsWith('.json')) {
          try {
            JSON.parse(content);
          } catch (error) {
            issues.push({
              path: relative,
              line: 1,
              severity: 'high',
              message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }
        issues.push(...genericStagedIssues(relative, content));
      }
    }

    const pythonAnalysis = pythonFiles.length
      ? await runPythonAnalysis(project.root, pythonFiles)
      : { files: [], summary: { total_files: 0 } };
    return {
      issues,
      pythonAnalysis,
      blockingIssues: issues.filter((issue) => issue.severity === 'high').length,
    };
  });

  app.post('/export/zip', async (request, reply) => {
    const input = ExportSchema.parse(request.body);
    const archive = await createZipBuffer(input.files);
    const fileName = `openbrowser-export-${Date.now()}.zip`;
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${fileName}"`)
      .send(archive);
  });

  app.post('/prompt', async (request) => {
    const input = PromptSchema.parse(request.body);
    const project = getActiveProject(database);
    const jobId = beginJob(database, project?.id ?? null, 'prompt');
    try {
      const response = await submitPrompt(input);
      completeJob(database, jobId, response);
      return { jobId, response };
    } catch (error) {
      failJob(database, jobId, error);
      throw error;
    }
  });

  app.post('/code/review', async (request) => {
    const input = ReviewSchema.parse(request.body);
    return submitPrompt({
      mode: 'ask',
      prompt: `Review this git diff. Identify correctness, security, data-loss, compatibility, and test gaps. Prioritize findings by severity.\n\n${input.diff}`,
      systemPrompt: 'You are a rigorous code reviewer. Do not invent defects; cite the relevant changed code.',
      conversationId: crypto.randomUUID(),
    });
  });

  app.post('/pr/analyze', async (request) => {
    const input = PullRequestAnalysisSchema.parse(request.body);
    const label = input.prNumber ? `pull request #${input.prNumber}` : 'pull request';
    return submitPrompt({
      mode: 'ask',
      prompt: `Analyze ${label} from this diff. Summarize intent, risks, breaking changes, missing tests, and recommended review actions.\n\n${input.diff}`,
      systemPrompt: 'You are a pull-request analysis specialist. Ground every conclusion in the supplied diff.',
      conversationId: crypto.randomUUID(),
    });
  });

  app.addHook('onClose', async () => {
    await closeWebSocketServer(websocketServer);
    database.close();
  });

  await app.ready();
  return app;
}

export async function startWorkspaceServer(options: WorkspaceServerOptions = {}): Promise<void> {
  const app = await createWorkspaceServer(options);
  const host = options.host ?? process.env.WORKSPACE_HOST ?? DEFAULT_HOST;
  const port = options.port ?? Number(process.env.WORKSPACE_PORT ?? DEFAULT_PORT);
  await app.listen({ host, port });
  console.log(`OpenBrowser Workspace companion listening on http://${host}:${port}`);
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
