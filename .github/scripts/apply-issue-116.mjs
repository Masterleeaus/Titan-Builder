import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Unable to find ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`Expected one ${label}, found multiple`);
  }
  return `${source.slice(0, index)}${after}${source.slice(index + before.length)}`;
}

const operationsPath = 'src/operations/index.ts';
let operations = fs.readFileSync(operationsPath, 'utf8');

operations = replaceOnce(
  operations,
  "  rollbackStatus?: 'not_required' | 'rolled_back' | 'rollback_failed';\n  error?: string;",
  "  rollbackStatus?: 'not_required' | 'rolled_back' | 'rollback_failed';\n  rollbackUnresolvedPaths?: string[];\n  rollbackEvidenceRetained?: boolean;\n  error?: string;",
  'transaction journal rollback fields',
);

operations = replaceOnce(
  operations,
  "    throw new Error(\n      `Operation transaction failed: ${message}. Rollback ${rollbackStatus === 'rolled_back' ? 'completed' : 'failed; inspect the transaction journal'}.`,\n      { cause: error },\n    );",
  "    const rollbackDetail = rollbackStatus === 'rolled_back'\n      ? 'completed'\n      : `failed: ${transaction.journal.rollbackUnresolvedPaths?.join('; ') ?? 'inspect the retained transaction evidence'}`;\n    throw new Error(\n      `Operation transaction failed: ${message}. Rollback ${rollbackDetail}.`,\n      { cause: error },\n    );",
  'transaction failure report',
);

const rollbackStart = operations.indexOf('async function rollbackTransaction(');
const rollbackEnd = operations.indexOf('async function writeTransactionJournal', rollbackStart);
if (rollbackStart < 0 || rollbackEnd < 0) {
  throw new Error('Unable to locate rollbackTransaction block');
}

const safeRollback = String.raw`class RollbackSafetyError extends Error {
  constructor(readonly unresolvedPaths: string[]) {
    super(
      \`Rollback safety validation failed: \${unresolvedPaths.join('; ')}\`,
    );
  }
}

interface RollbackControlPaths {
  root: string;
  rootDevice: number;
  journalPath: string;
  backupRoot: string;
}

async function rollbackTransaction(
  transaction: PreparedTransaction,
  errorMessage: string,
): Promise<'rolled_back' | 'rollback_failed'> {
  let control: RollbackControlPaths | undefined;

  try {
    control = await validateRollbackControlPaths(transaction);
    await preflightRollback(transaction, control);
  } catch (rollbackError) {
    const unresolvedPaths = rollbackError instanceof RollbackSafetyError
      ? rollbackError.unresolvedPaths
      : [formatUnknownError(rollbackError)];
    transaction.journal.status = 'rollback_failed';
    transaction.journal.rollbackStatus = 'rollback_failed';
    transaction.journal.rollbackUnresolvedPaths = unresolvedPaths;
    transaction.journal.rollbackEvidenceRetained = true;
    transaction.journal.error = \`\${errorMessage}; rollback safety validation failed: \${unresolvedPaths.join('; ')}\`;
    transaction.journal.updatedAt = new Date().toISOString();
    if (control) {
      await writeTransactionJournal(transaction).catch(() => undefined);
    }
    return 'rollback_failed';
  }

  transaction.journal.status = 'rolling_back';
  transaction.journal.error = errorMessage;
  transaction.journal.rollbackUnresolvedPaths = undefined;
  transaction.journal.rollbackEvidenceRetained = true;
  transaction.journal.updatedAt = new Date().toISOString();
  await writeTransactionJournal(transaction);

  try {
    const targets = transaction.snapshots
      .filter((snapshot) => snapshot.role === 'target')
      .sort((left, right) => pathDepth(right.relativePath) - pathDepth(left.relativePath));

    for (const snapshot of targets) {
      await restoreRollbackTarget(control, snapshot);
    }

    const parents = transaction.snapshots
      .filter((snapshot) => snapshot.role === 'parent')
      .sort((left, right) => pathDepth(right.relativePath) - pathDepth(left.relativePath));
    for (const snapshot of parents) {
      await restoreRollbackParent(control, snapshot);
    }

    transaction.journal.status = 'rolled_back';
    transaction.journal.rollbackStatus = 'rolled_back';
    transaction.journal.rollbackUnresolvedPaths = undefined;
    transaction.journal.rollbackEvidenceRetained = true;
    transaction.journal.updatedAt = new Date().toISOString();
    await writeTransactionJournal(transaction);

    await removeRollbackPathNoFollow(
      control,
      path.relative(control.root, control.backupRoot),
    );
    transaction.journal.rollbackEvidenceRetained = false;
    transaction.journal.updatedAt = new Date().toISOString();
    await writeTransactionJournal(transaction);
    return 'rolled_back';
  } catch (rollbackError) {
    const unresolvedPaths = rollbackError instanceof RollbackSafetyError
      ? rollbackError.unresolvedPaths
      : [formatUnknownError(rollbackError)];
    transaction.journal.status = 'rollback_failed';
    transaction.journal.rollbackStatus = 'rollback_failed';
    transaction.journal.rollbackUnresolvedPaths = unresolvedPaths;
    transaction.journal.rollbackEvidenceRetained = true;
    transaction.journal.error = \`\${errorMessage}; rollback failed: \${unresolvedPaths.join('; ')}\`;
    transaction.journal.updatedAt = new Date().toISOString();
    await writeTransactionJournal(transaction).catch(() => undefined);
    return 'rollback_failed';
  }
}

async function validateRollbackControlPaths(
  transaction: PreparedTransaction,
): Promise<RollbackControlPaths> {
  const root = await canonicalizeProjectRoot(transaction.journal.projectRoot);
  if (!sameFilesystemPath(root, transaction.journal.projectRoot)) {
    throw new RollbackSafetyError([
      \`project root identity changed from \${transaction.journal.projectRoot} to \${root}\`,
    ]);
  }

  const transactionsRoot = await resolveProjectPath(
    root,
    path.join('.openbrowser', 'transactions'),
    { requireExisting: true, expectedType: 'directory' },
  );
  const expectedJournalPath = path.join(transactionsRoot, \`\${transaction.journal.id}.json\`);
  const expectedBackupRoot = path.join(transactionsRoot, \`\${transaction.journal.id}.backup\`);
  if (!sameFilesystemPath(path.resolve(transaction.journalPath), expectedJournalPath)) {
    throw new RollbackSafetyError(['transaction journal path identity changed']);
  }
  if (!sameFilesystemPath(path.resolve(transaction.backupRoot), expectedBackupRoot)) {
    throw new RollbackSafetyError(['transaction backup path identity changed']);
  }

  const journalPath = await resolveProjectPath(
    root,
    path.relative(root, expectedJournalPath),
    { requireExisting: true, expectedType: 'file' },
  );
  const backupRoot = await resolveProjectPath(
    root,
    path.relative(root, expectedBackupRoot),
    { requireExisting: true, expectedType: 'directory' },
  );
  const rootDevice = (await fs.stat(root)).dev;
  await assertRollbackNode(rootDevice, transactionsRoot, 'transaction directory');
  await assertRollbackNode(rootDevice, journalPath, 'transaction journal');
  await assertRollbackNode(rootDevice, backupRoot, 'transaction backup directory');

  transaction.journalPath = journalPath;
  transaction.backupRoot = backupRoot;
  return { root, rootDevice, journalPath, backupRoot };
}

async function preflightRollback(
  transaction: PreparedTransaction,
  control: RollbackControlPaths,
): Promise<void> {
  const unresolvedPaths: string[] = [];
  for (const snapshot of transaction.snapshots) {
    try {
      const relativePath = normalizeRollbackRelativePath(snapshot.relativePath);
      const absolutePath = await resolveProjectPath(control.root, relativePath);
      await assertRollbackNode(control.rootDevice, absolutePath, relativePath, true);

      const parentRelative = path.dirname(relativePath);
      if (parentRelative !== '.') {
        const parentPath = await resolveProjectPath(control.root, parentRelative);
        await assertRollbackNode(control.rootDevice, parentPath, parentRelative, true);
      }

      if (snapshot.role === 'target') {
        await validateRollbackRemovalTree(control, relativePath);
      }
      if (snapshot.kind === 'file') {
        await resolveRollbackBackup(control, snapshot);
      }
    } catch (error) {
      unresolvedPaths.push(\`\${snapshot.relativePath}: \${formatUnknownError(error)}\`);
    }
  }

  if (unresolvedPaths.length > 0) {
    throw new RollbackSafetyError(unresolvedPaths);
  }
}

async function restoreRollbackTarget(
  control: RollbackControlPaths,
  snapshot: RollbackSnapshot,
): Promise<void> {
  const relativePath = normalizeRollbackRelativePath(snapshot.relativePath);
  await resolveProjectPath(control.root, relativePath);

  if (snapshot.kind === 'missing') {
    await removeRollbackPathNoFollow(control, relativePath);
    return;
  }

  if (snapshot.kind === 'directory') {
    const absolutePath = await resolveProjectPath(control.root, relativePath);
    const metadata = await lstatIfPresent(absolutePath);
    if (metadata && !metadata.isDirectory()) {
      await removeRollbackPathNoFollow(control, relativePath);
    }
    await ensureRollbackDirectory(control, relativePath);
    return;
  }

  const backupPath = await resolveRollbackBackup(control, snapshot);
  await removeRollbackPathNoFollow(control, relativePath);
  await ensureRollbackDirectory(control, path.dirname(relativePath));
  const targetPath = await resolveProjectPath(control.root, relativePath, { expectedType: 'file' });
  const backupContent = await fs.readFile(backupPath);
  await safeWriteFile(targetPath, backupContent);
  const restoredPath = await resolveProjectPath(
    control.root,
    relativePath,
    { requireExisting: true, expectedType: 'file' },
  );
  if (snapshot.mode !== undefined) {
    await fs.chmod(restoredPath, snapshot.mode);
  }
}

async function restoreRollbackParent(
  control: RollbackControlPaths,
  snapshot: RollbackSnapshot,
): Promise<void> {
  const relativePath = normalizeRollbackRelativePath(snapshot.relativePath);
  if (snapshot.kind === 'missing') {
    const absolutePath = await resolveProjectPath(control.root, relativePath);
    const metadata = await lstatIfPresent(absolutePath);
    if (!metadata) return;
    if (!metadata.isDirectory()) {
      throw new RollbackSafetyError([
        \`\${relativePath}: rollback parent is no longer a directory\`,
      ]);
    }
    const directory = await resolveProjectPath(
      control.root,
      relativePath,
      { requireExisting: true, expectedType: 'directory' },
    );
    try {
      await fs.rmdir(directory);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') {
        throw error;
      }
    }
    return;
  }

  if (snapshot.kind !== 'directory') {
    throw new RollbackSafetyError([
      \`\${relativePath}: rollback parent snapshot has invalid type \${snapshot.kind}\`,
    ]);
  }
  await ensureRollbackDirectory(control, relativePath);
}

async function resolveRollbackBackup(
  control: RollbackControlPaths,
  snapshot: RollbackSnapshot,
): Promise<string> {
  if (!snapshot.backupPath) {
    throw new Error(\`Missing rollback backup for \${snapshot.relativePath}\`);
  }
  const backupRelative = path.relative(control.root, snapshot.backupPath);
  if (
    !backupRelative ||
    path.isAbsolute(backupRelative) ||
    backupRelative === '..' ||
    backupRelative.startsWith(\`..\${path.sep}\`)
  ) {
    throw new Error(\`Rollback backup escapes the project: \${snapshot.relativePath}\`);
  }
  const backupPath = await resolveProjectPath(
    control.root,
    backupRelative,
    { requireExisting: true, expectedType: 'file' },
  );
  const insideBackupRoot = path.relative(control.backupRoot, backupPath);
  if (
    !insideBackupRoot ||
    path.isAbsolute(insideBackupRoot) ||
    insideBackupRoot === '..' ||
    insideBackupRoot.startsWith(\`..\${path.sep}\`)
  ) {
    throw new Error(\`Rollback backup is outside the transaction backup root: \${snapshot.relativePath}\`);
  }
  await assertRollbackNode(control.rootDevice, backupPath, snapshot.relativePath);
  return backupPath;
}

async function validateRollbackRemovalTree(
  control: RollbackControlPaths,
  relativePath: string,
): Promise<void> {
  const absolutePath = await resolveProjectPath(control.root, relativePath);
  const metadata = await lstatIfPresent(absolutePath);
  if (!metadata) return;
  await assertRollbackNode(control.rootDevice, absolutePath, relativePath);
  if (!metadata.isDirectory()) return;

  const entries = await fs.readdir(absolutePath);
  for (const entry of entries) {
    await validateRollbackRemovalTree(control, path.join(relativePath, entry));
  }
}

async function removeRollbackPathNoFollow(
  control: RollbackControlPaths,
  relativePath: string,
): Promise<void> {
  const normalized = normalizeRollbackRelativePath(relativePath);
  const absolutePath = await resolveProjectPath(control.root, normalized);
  const metadata = await lstatIfPresent(absolutePath);
  if (!metadata) return;
  await assertRollbackNode(control.rootDevice, absolutePath, normalized);

  if (metadata.isDirectory()) {
    const entries = await fs.readdir(absolutePath);
    for (const entry of entries) {
      await removeRollbackPathNoFollow(control, path.join(normalized, entry));
    }
    const directory = await resolveProjectPath(
      control.root,
      normalized,
      { requireExisting: true, expectedType: 'directory' },
    );
    await fs.rmdir(directory);
    return;
  }

  if (!metadata.isFile()) {
    throw new RollbackSafetyError([
      \`\${normalized}: unsupported rollback filesystem node\`,
    ]);
  }
  const filePath = await resolveProjectPath(
    control.root,
    normalized,
    { requireExisting: true, expectedType: 'file' },
  );
  await unlink(filePath);
}

async function ensureRollbackDirectory(
  control: RollbackControlPaths,
  relativePath: string,
): Promise<string> {
  if (!relativePath || relativePath === '.') return control.root;
  const normalized = normalizeRollbackRelativePath(relativePath);
  const segments = normalized.split(path.sep).filter(Boolean);
  let currentRelative = '';

  for (const segment of segments) {
    currentRelative = currentRelative ? path.join(currentRelative, segment) : segment;
    let absolutePath = await resolveProjectPath(control.root, currentRelative);
    const metadata = await lstatIfPresent(absolutePath);
    if (metadata) {
      await assertRollbackNode(control.rootDevice, absolutePath, currentRelative);
      if (!metadata.isDirectory()) {
        await removeRollbackPathNoFollow(control, currentRelative);
      } else {
        continue;
      }
    }

    const parentRelative = path.dirname(currentRelative);
    await resolveProjectPath(
      control.root,
      parentRelative === '.' ? '.' : parentRelative,
      { requireExisting: true, expectedType: 'directory' },
    );
    absolutePath = path.resolve(control.root, currentRelative);
    await fs.mkdir(absolutePath);
    await resolveProjectPath(
      control.root,
      currentRelative,
      { requireExisting: true, expectedType: 'directory' },
    );
  }

  return resolveProjectPath(
    control.root,
    normalized,
    { requireExisting: true, expectedType: 'directory' },
  );
}

async function assertRollbackNode(
  rootDevice: number,
  absolutePath: string,
  displayPath: string,
  allowMissing = false,
): Promise<void> {
  const metadata = await lstatIfPresent(absolutePath);
  if (!metadata) {
    if (allowMissing) return;
    throw new Error(\`Rollback path does not exist: \${displayPath}\`);
  }
  if (metadata.isSymbolicLink()) {
    throw new Error(\`Rollback path contains a symbolic link or junction: \${displayPath}\`);
  }
  if (metadata.dev !== rootDevice) {
    throw new Error(\`Rollback path crosses a mount or device boundary: \${displayPath}\`);
  }
  if (!metadata.isFile() && !metadata.isDirectory()) {
    throw new Error(\`Rollback path has an unsupported filesystem type: \${displayPath}\`);
  }
}

async function lstatIfPresent(absolutePath: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function normalizeRollbackRelativePath(relativePath: string): string {
  const normalized = path.normalize(relativePath);
  if (
    !relativePath ||
    normalized === '.' ||
    path.isAbsolute(relativePath) ||
    normalized === '..' ||
    normalized.startsWith(\`..\${path.sep}\`)
  ) {
    throw new Error(\`Invalid rollback path: \${relativePath}\`);
  }
  return normalized;
}

function sameFilesystemPath(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US')
    : normalizedLeft === normalizedRight;
}

`;

operations = `${operations.slice(0, rollbackStart)}${safeRollback}${operations.slice(rollbackEnd)}`;
operations = replaceOnce(
  operations,
  'async function safeWriteFile(filePath: string, content: string): Promise<void> {',
  'async function safeWriteFile(filePath: string, content: string | Uint8Array): Promise<void> {',
  'safeWriteFile buffer support',
);
fs.writeFileSync(operationsPath, operations);

const testPath = 'src/operations/transaction.integration.test.ts';
let tests = fs.readFileSync(testPath, 'utf8');
const testMarker = "test('existing project root is canonical before planning starts'";
const testIndex = tests.indexOf(testMarker);
if (testIndex < 0) throw new Error('Unable to locate transaction test insertion point');

const rollbackTests = String.raw`test('rollback refuses a parent junction or symlink swap before touching outside files', async () => {
  const projectRoot = await createProject();
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openbrowser-rollback-outside-'));
  const safeDirectory = path.join(projectRoot, 'safe');
  const outsideSentinel = path.join(outsideRoot, 'sentinel.txt');
  await fs.ensureDir(safeDirectory);
  await writeFile(path.join(safeDirectory, 'value.txt'), 'before\n', 'utf8');
  await writeFile(outsideSentinel, 'outside unchanged\n', 'utf8');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  await writeFile(
    path.join(projectRoot, 'swap-and-fail.mjs'),
    [
      "import fs from 'node:fs';",
      \`const safeDirectory = \${JSON.stringify(safeDirectory)};\`,
      \`const outsideRoot = \${JSON.stringify(outsideRoot)};\`,
      \`fs.rmSync(safeDirectory, { recursive: true, force: true });\`,
      \`fs.symlinkSync(outsideRoot, safeDirectory, \${JSON.stringify(linkType)});\`,
      'process.exit(1);',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'node swap-and-fail.mjs' } }),
    'utf8',
  );

  try {
    const plans = await planOperations([
      { action: 'EDIT_FILE', path: 'safe/value.txt', content: 'after\n' },
      { action: 'RUN_TOOL', tool: 'npm.test' },
    ], projectRoot);

    await assert.rejects(
      executePlannedOperations(plans, projectRoot),
      /Rollback failed:.*safe|rollback safety validation failed/i,
    );
    assert.equal(await readFile(outsideSentinel, 'utf8'), 'outside unchanged\n');
    assert.equal(await fs.pathExists(path.join(outsideRoot, 'value.txt')), false);

    const transactionDirectory = path.join(projectRoot, '.openbrowser', 'transactions');
    const transactionEntries = await fs.readdir(transactionDirectory);
    const journalName = transactionEntries.find((name) => name.endsWith('.json'));
    assert.ok(journalName);
    assert.equal(transactionEntries.some((name) => name.endsWith('.backup')), true);
    const journal = await fs.readJson(path.join(transactionDirectory, journalName)) as {
      status?: string;
      rollbackStatus?: string;
      rollbackEvidenceRetained?: boolean;
      rollbackUnresolvedPaths?: string[];
    };
    assert.equal(journal.status, 'rollback_failed');
    assert.equal(journal.rollbackStatus, 'rollback_failed');
    assert.equal(journal.rollbackEvidenceRetained, true);
    assert.equal(journal.rollbackUnresolvedPaths?.some((entry) => entry.includes('safe')), true);
  } finally {
    await fs.unlink(safeDirectory).catch(() => undefined);
    await fs.remove(projectRoot);
    await fs.remove(outsideRoot);
  }
});

test('rollback refuses a swapped file target before changing the outside target', async () => {
  if (process.platform === 'win32') return;
  const projectRoot = await createProject();
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openbrowser-rollback-target-'));
  const projectFile = path.join(projectRoot, 'value.txt');
  const outsideFile = path.join(outsideRoot, 'outside.txt');
  await writeFile(projectFile, 'before\n', 'utf8');
  await writeFile(outsideFile, 'outside unchanged\n', 'utf8');
  await writeFile(
    path.join(projectRoot, 'swap-target-and-fail.mjs'),
    [
      "import fs from 'node:fs';",
      \`const projectFile = \${JSON.stringify(projectFile)};\`,
      \`const outsideFile = \${JSON.stringify(outsideFile)};\`,
      'fs.rmSync(projectFile, { force: true });',
      'fs.symlinkSync(outsideFile, projectFile);',
      'process.exit(1);',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'node swap-target-and-fail.mjs' } }),
    'utf8',
  );

  try {
    const plans = await planOperations([
      { action: 'EDIT_FILE', path: 'value.txt', content: 'after\n' },
      { action: 'RUN_TOOL', tool: 'npm.test' },
    ], projectRoot);
    await assert.rejects(
      executePlannedOperations(plans, projectRoot),
      /Rollback failed:.*value\.txt|rollback safety validation failed/i,
    );
    assert.equal(await readFile(outsideFile, 'utf8'), 'outside unchanged\n');
  } finally {
    await fs.unlink(projectFile).catch(() => undefined);
    await fs.remove(projectRoot);
    await fs.remove(outsideRoot);
  }
});

`;

tests = `${tests.slice(0, testIndex)}${rollbackTests}${tests.slice(testIndex)}`;
fs.writeFileSync(testPath, tests);
