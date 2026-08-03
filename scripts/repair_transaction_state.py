#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

PATH = Path('src/operations/index.ts')
source = PATH.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    source = source.replace(old, new, 1)


def replace_between(start: str, end: str, replacement: str, label: str) -> None:
    global source
    start_index = source.find(start)
    end_index = source.find(end, start_index + len(start))
    if start_index < 0 or end_index < 0:
        raise SystemExit(f'{label}: replacement boundaries not found')
    source = source[:start_index] + replacement + source[end_index:]


replace_once(
    "import type { HistoryEntry } from '../memory/index.js';\n",
    "import type { HistoryEntry } from '../memory/index.js';\n"
    "import { openProjectInternalState, type ProjectInternalState } from '../security/internal-state.js';\n",
    'internal-state import',
)
replace_once(
    """interface PreparedTransaction {
  journal: TransactionJournal;
  journalPath: string;
  backupRoot: string;
  snapshots: RollbackSnapshot[];
}
""",
    """interface PreparedTransaction {
  state: ProjectInternalState;
  journal: TransactionJournal;
  journalPath: string;
  backupRoot: string;
  snapshots: RollbackSnapshot[];
}
""",
    'prepared transaction state',
)
replace_once(
    "    await fs.remove(transaction.backupRoot);",
    "    await transaction.state.removeTree(\n"
    "      path.relative(transaction.state.stateRoot, transaction.backupRoot),\n"
    "    );",
    'post-commit backup cleanup',
)

prepare_start = 'async function prepareTransaction(\n'
prepare_end = 'function collectParentPaths('
prepare = """async function prepareTransaction(
  projectRoot: string,
  plans: PlannedOperation[],
  conversationId?: string,
): Promise<PreparedTransaction> {
  const state = await openProjectInternalState(projectRoot);
  const id = crypto.randomUUID();
  const transactionsRoot = await state.ensureDirectory('transactions');
  const journalPath = path.join(transactionsRoot, `${id}.json`);
  const backupRootRelative = path.join('transactions', `${id}.backup`);
  const backupRoot = await state.ensureDirectory(backupRootRelative);
  const projectRootIdentity = await readFilesystemIdentity(projectRoot);
  const firstPreconditions = new Map<string, PathPrecondition>();

  for (const plan of plans) {
    for (const precondition of plan.preconditions) {
      if (!firstPreconditions.has(precondition.absolutePath)) {
        firstPreconditions.set(precondition.absolutePath, precondition);
      }
    }
  }

  for (const precondition of firstPreconditions.values()) {
    await verifyPreconditions([precondition]);
  }

  const snapshots: RollbackSnapshot[] = [];
  for (const absolutePath of firstPreconditions.keys()) {
    const snapshot = await readPathSnapshot(absolutePath);
    snapshots.push({
      ...snapshot,
      absolutePath,
      relativePath: path.relative(projectRoot, absolutePath),
      role: 'target',
    });
  }

  const parentPaths = collectParentPaths(projectRoot, [...firstPreconditions.keys()]);
  for (const absolutePath of parentPaths) {
    const snapshot = await readPathSnapshot(absolutePath);
    snapshots.push({
      ...snapshot,
      absolutePath,
      relativePath: path.relative(projectRoot, absolutePath),
      role: 'parent',
    });
  }

  let backupIndex = 0;
  for (const snapshot of snapshots) {
    if (snapshot.kind !== 'file') continue;
    const backupRelativePath = path.join(backupRootRelative, `${backupIndex}.bak`);
    backupIndex += 1;
    await state.copyFromFile(backupRelativePath, snapshot.absolutePath);
    snapshot.backupPath = path.join(state.stateRoot, backupRelativePath);
  }

  const now = new Date().toISOString();
  const journal: TransactionJournal = {
    id,
    status: 'prepared',
    projectRoot,
    projectRootIdentity,
    conversationId,
    operationCount: plans.length,
    createdAt: now,
    updatedAt: now,
    externalEffectsPossible: plans.some((plan) =>
      plan.operation.action === 'RUN_COMMAND' ||
      (plan.operation.action === 'RUN_TOOL' && plan.risk !== 'READ')
    ),
    snapshots: snapshots.map((snapshot) => ({
      relativePath: snapshot.relativePath,
      kind: snapshot.kind,
      hash: snapshot.hash,
      role: snapshot.role,
      backupPath: snapshot.backupPath
        ? path.relative(transactionsRoot, snapshot.backupPath)
        : undefined,
    })),
  };

  const transaction = { state, journal, journalPath, backupRoot, snapshots };
  await writeTransactionJournal(transaction);
  return transaction;
}

"""
replace_between(prepare_start, prepare_end, prepare, 'transaction preparation')

replace_once(
    """      const backupPath = await resolveRollbackBackupPath(
        projectRoot,
        validated.backupRoot,
        entry.snapshot,
      );
      await fs.remove(absolutePath);
      await resolveRollbackParent(projectRoot, entry.snapshot.relativePath);
      await fs.copyFile(backupPath, absolutePath);
""",
    """      const backupPath = await resolveRollbackBackupPath(
        transaction,
        validated.backupRoot,
        entry.snapshot,
      );
      const backupContent = await transaction.state.readBuffer(
        path.relative(transaction.state.stateRoot, backupPath),
      );
      await fs.remove(absolutePath);
      await resolveRollbackParent(projectRoot, entry.snapshot.relativePath);
      await fs.writeFile(absolutePath, backupContent);
""",
    'rollback backup restoration',
)
replace_once(
    "    await fs.remove(validated.backupRoot);",
    "    await transaction.state.removeTree(\n"
    "      path.relative(transaction.state.stateRoot, validated.backupRoot),\n"
    "    );",
    'rollback backup cleanup',
)
replace_once(
    '  const backupRoot = await resolveRollbackBackupRoot(projectRoot, transaction.backupRoot);',
    '  const backupRoot = await resolveRollbackBackupRoot(transaction);',
    'rollback backup-root validation call',
)
replace_once(
    """      ? await resolveRollbackBackupPath(projectRoot, backupRoot, snapshot)
      : undefined;
""",
    """      ? await resolveRollbackBackupPath(transaction, backupRoot, snapshot)
      : undefined;
""",
    'rollback backup validation call',
)

replace_between(
    'async function resolveRollbackBackupRoot(',
    'async function resolveRollbackTarget(',
    """async function resolveRollbackBackupRoot(
  transaction: PreparedTransaction,
): Promise<string> {
  await assertRollbackProjectIdentity(transaction);
  const relativePath = path.relative(transaction.state.stateRoot, transaction.backupRoot);
  assertSafeRollbackRelativePath(relativePath, 'rollback backup directory');
  const expectedPath = path.resolve(transaction.state.stateRoot, relativePath);
  if (expectedPath !== transaction.backupRoot) {
    throw new Error(`Rollback backup directory identity changed: ${relativePath}`);
  }
  const metadata = await fs.lstat(expectedPath);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Rollback backup directory is a symbolic link or junction: ${relativePath}`);
  }
  const canonicalPath = await fs.realpath(expectedPath);
  if (canonicalPath !== expectedPath) {
    throw new Error(`Rollback backup directory is redirected: ${relativePath}`);
  }
  return expectedPath;
}

""",
    'rollback backup-root resolver',
)
replace_between(
    'async function resolveRollbackBackupPath(',
    'function assertSafeRollbackRelativePath(',
    """async function resolveRollbackBackupPath(
  transaction: PreparedTransaction,
  backupRoot: string,
  snapshot: RollbackSnapshot,
): Promise<string> {
  if (!snapshot.backupPath) {
    throw new Error(`Missing rollback backup for ${snapshot.relativePath}`);
  }

  const backupRelativePath = path.relative(backupRoot, snapshot.backupPath);
  assertSafeRollbackRelativePath(backupRelativePath, 'rollback backup');
  const expectedBackupPath = path.resolve(backupRoot, backupRelativePath);
  if (!isPathInside(backupRoot, expectedBackupPath)) {
    throw new Error(`Rollback backup escaped its transaction directory: ${backupRelativePath}`);
  }

  await transaction.state.readBuffer(
    path.relative(transaction.state.stateRoot, expectedBackupPath),
  );
  return expectedBackupPath;
}

""",
    'rollback backup-file resolver',
)

replace_between(
    'async function resolveInternalMetadataPath(',
    'async function appendTransactionHistory(',
    '',
    'obsolete internal metadata resolver',
)
replace_between(
    'async function appendTransactionHistory(',
    'async function writeTransactionJournal(',
    """async function appendTransactionHistory(
  transaction: PreparedTransaction,
  entry: HistoryEntry,
): Promise<void> {
  await assertRollbackProjectIdentity(transaction);
  const relativePath = 'history.json';
  let history: HistoryEntry[] = [];

  if (await transaction.state.fileExists(relativePath)) {
    const parsed = await transaction.state.readJson<unknown>(relativePath);
    if (!Array.isArray(parsed)) {
      throw new Error('Transaction history file must contain an array');
    }
    history = parsed as HistoryEntry[];
  }

  history.push(entry);
  await transaction.state.writeJson(relativePath, history);
}

""",
    'transaction history writer',
)
replace_between(
    'async function writeTransactionJournal(',
    'function pathDepth(',
    """async function writeTransactionJournal(transaction: PreparedTransaction): Promise<void> {
  await assertRollbackProjectIdentity(transaction);
  await transaction.state.writeJson(
    path.relative(transaction.state.stateRoot, transaction.journalPath),
    transaction.journal,
  );
}

""",
    'transaction journal writer',
)

PATH.write_text(source, encoding='utf-8')
