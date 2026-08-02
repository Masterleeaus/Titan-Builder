import { readFile, writeFile } from 'node:fs/promises';

const filePath = new URL('../src/operations/index.ts', import.meta.url);
let source = await readFile(filePath, 'utf8');

const importNeedle = "import { preserveOperationOrder } from './operation-order.js';\n";
const importReplacement = `${importNeedle}import {\n  preflightRollback,\n  removeRollbackBackup,\n  restoreRollbackParent,\n  restoreRollbackTarget,\n} from './rollback-containment.js';\n`;

if (!source.includes(importNeedle)) {
  throw new Error('Could not locate operation-order import');
}
if (!source.includes("from './rollback-containment.js'")) {
  source = source.replace(importNeedle, importReplacement);
}

const startMarker = 'async function rollbackTransaction(';
const endMarker = '\nasync function writeTransactionJournal';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) {
  throw new Error('Could not locate rollbackTransaction function boundaries');
}

const replacement = `async function rollbackTransaction(
  transaction: PreparedTransaction,
  errorMessage: string,
): Promise<'rolled_back' | 'rollback_failed'> {
  transaction.journal.status = 'rolling_back';
  transaction.journal.error = errorMessage;
  transaction.journal.updatedAt = new Date().toISOString();
  await writeTransactionJournal(transaction).catch(() => undefined);

  try {
    const validation = await preflightRollback(
      transaction.journal.projectRoot,
      transaction.backupRoot,
      transaction.snapshots,
    );

    for (const snapshot of validation.targets) {
      await restoreRollbackTarget(validation, snapshot);
    }

    for (const snapshot of validation.parents) {
      await restoreRollbackParent(validation, snapshot);
    }

    transaction.journal.status = 'rolled_back';
    transaction.journal.rollbackStatus = 'rolled_back';
    transaction.journal.updatedAt = new Date().toISOString();
    await removeRollbackBackup(validation);
    await writeTransactionJournal(transaction);
    return 'rolled_back';
  } catch (rollbackError) {
    transaction.journal.status = 'rollback_failed';
    transaction.journal.rollbackStatus = 'rollback_failed';
    transaction.journal.error = \`${errorMessage}; rollback failed: \${formatUnknownError(rollbackError)}\`;
    transaction.journal.updatedAt = new Date().toISOString();
    await writeTransactionJournal(transaction).catch(() => undefined);
    return 'rollback_failed';
  }
}
`;

source = `${source.slice(0, start)}${replacement}${source.slice(end)}`;
await writeFile(filePath, source, 'utf8');
