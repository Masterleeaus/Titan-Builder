#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

TEST_PATH = Path('src/shared/silent-catch-policy.test.ts')
TEST_CONTENT = """import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const SOURCE_ROOT = path.resolve(import.meta.dirname, '..');
const SILENT_PROMISE_CATCH = /\\.catch\\(\\s*\\(\\s*\\)\\s*=>\\s*(?:undefined|null)\\s*\\)/gu;

async function collectProductionSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectProductionSources(absolutePath));
      continue;
    }
    if (!entry.isFile() || !/\\.(?:ts|js|mjs|cjs)$/u.test(entry.name)) continue;
    if (/\\.(?:test|spec)\\./u.test(entry.name)) continue;
    files.push(absolutePath);
  }
  return files;
}

test('production source does not silently discard rejected promises', async () => {
  const offenders: string[] = [];
  for (const filePath of await collectProductionSources(SOURCE_ROOT)) {
    const source = await readFile(filePath, 'utf8');
    for (const match of source.matchAll(SILENT_PROMISE_CATCH)) {
      const line = source.slice(0, match.index).split('\\n').length;
      offenders.push(`${path.relative(SOURCE_ROOT, filePath)}:${line}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Rejected promises must be handled or logged; found silent catches:\\n${offenders.join('\\n')}`,
  );
});
"""


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"Expected exactly one match in {path}, found {count}: {old[:100]!r}"
        )
    file_path.write_text(text.replace(old, new, 1))


def write_test() -> None:
    TEST_PATH.write_text(TEST_CONTENT)


def repair_lockfile() -> None:
    lock_path = Path('pnpm-lock.yaml')
    lines = lock_path.read_text().splitlines(keepends=True)
    try:
        packages_start = lines.index('packages:\n')
        snapshots_start = lines.index('snapshots:\n')
    except ValueError as error:
        raise SystemExit('pnpm lockfile is missing packages or snapshots section') from error

    key = '  braces@3.0.3:\n'
    indices = [
        index
        for index in range(packages_start + 1, snapshots_start)
        if lines[index] == key
    ]
    if len(indices) != 2:
        raise SystemExit(
            f"Expected exactly two braces entries in packages section, found {len(indices)}"
        )

    second = indices[1]
    end = second + 1
    while end < snapshots_start and (
        lines[end].startswith('    ') or not lines[end].strip()
    ):
        end += 1
    del lines[second:end]
    lock_path.write_text(''.join(lines))


def apply_fix() -> None:
    repair_lockfile()

    replace_once(
        'src/server/browser-workflow-routes.ts',
        "import type { FastifyInstance, FastifyReply } from 'fastify';\n",
        "import type { FastifyInstance, FastifyReply } from 'fastify';\n"
        "import { logger } from '../shared/index.js';\n",
    )
    replace_once(
        'src/server/browser-workflow-routes.ts',
        "logger.warn({ runId, error }, 'SSE update fetch failed');",
        "logger.warn({ err: error, runId }, 'SSE update fetch failed');",
    )

    replace_once(
        'src/client/bridge-client.ts',
        "import { loadOpenBrowserEnvironment } from '../config/environment.js';\n",
        "import { loadOpenBrowserEnvironment } from '../config/environment.js';\n"
        "import { logger } from '../shared/index.js';\n",
    )
    replace_once(
        'src/client/bridge-client.ts',
        "      reader.cancel().catch(() => undefined);",
        "      void reader.cancel().catch((error: unknown) => {\n"
        "        logger.debug({ err: error, sessionId }, "
        "'Failed to cancel session SSE reader during cleanup');\n"
        "      });",
    )
    replace_once(
        'src/client/bridge-client.ts',
        "    } catch {\n      // Ignore malformed SSE payloads.\n    }",
        "    } catch (error) {\n"
        "      logger.debug({ err: error, event }, "
        "'Ignored malformed or rejected SSE payload');\n"
        "    }",
    )

    replace_once(
        'src/operations/process-runner.ts',
        "import process from 'node:process';\n",
        "import process from 'node:process';\n"
        "import { logger } from '../shared/index.js';\n",
    )
    replace_once(
        'src/operations/process-runner.ts',
        "  } catch {\n    return undefined;\n  }\n}\n\n"
        "async function terminateWindowsProcessTree",
        "  } catch (error) {\n"
        "    logger.debug({ err: error, rootPid }, "
        "'Failed to enumerate POSIX process tree; falling back to PID probes');\n"
        "    return undefined;\n  }\n}\n\n"
        "async function terminateWindowsProcessTree",
    )
    replace_once(
        'src/operations/process-runner.ts',
        "  } catch {\n    return new Set([rootPid]);\n  }\n}\n\n"
        "function collectDescendants",
        "  } catch (error) {\n"
        "    logger.debug({ err: error, rootPid }, "
        "'Failed to enumerate Windows process tree; falling back to root PID');\n"
        "    return new Set([rootPid]);\n  }\n}\n\n"
        "function collectDescendants",
    )
    replace_once(
        'src/operations/process-runner.ts',
        "  await execFileText('taskkill.exe', args).catch(() => undefined);",
        "  try {\n    await execFileText('taskkill.exe', args);\n"
        "  } catch (error) {\n"
        "    logger.debug({ err: error, pid, force }, "
        "'taskkill failed during best-effort process-tree termination');\n"
        "  }",
    )

    replace_once(
        'src/operations/index.ts',
        "import type { FileOperation } from '../core/index.js';\n",
        "import type { FileOperation } from '../core/index.js';\n"
        "import { logger } from '../shared/index.js';\n",
    )
    replace_once(
        'src/operations/index.ts',
        "        logger.error({ journalError }, "
        "'Failed to write transaction journal during error handling');",
        "        logger.error(\n"
        "          { err: journalError, transactionId: transaction.journal.id },\n"
        "          'Failed to write transaction journal during error handling',\n"
        "        );",
    )
    replace_once(
        'src/operations/index.ts',
        "    await writeTransactionJournal(transaction).catch(() => undefined);\n"
        "    throw new Error(\n"
        "      `Operation transaction committed, but post-commit finalization failed: "
        "${message}. Applied changes were not rolled back.`,",
        "    await writeTransactionJournal(transaction).catch((journalError) => {\n"
        "      logger.error(\n"
        "        { err: journalError, transactionId: transaction.journal.id },\n"
        "        'Failed to persist post-commit finalization error',\n"
        "      );\n"
        "    });\n"
        "    throw new Error(\n"
        "      `Operation transaction committed, but post-commit finalization failed: "
        "${message}. Applied changes were not rolled back.`,",
    )
    replace_once(
        'src/operations/index.ts',
        "    await fs.remove(validated.backupRoot);",
        "    await fs.remove(transaction.backupRoot);",
    )
    replace_once(
        'src/operations/index.ts',
        "    await writeTransactionJournal(transaction).catch(() => undefined);\n"
        "    return 'rollback_failed';",
        "    await writeTransactionJournal(transaction).catch((journalError) => {\n"
        "      logger.error(\n"
        "        { err: journalError, transactionId: transaction.journal.id },\n"
        "        'Failed to persist rollback failure in transaction journal',\n"
        "      );\n"
        "    });\n"
        "    return 'rollback_failed';",
    )

    replace_once(
        'package.json',
        "src/client/response-timeout.test.ts src/operations/mkdir-normalize.test.ts",
        "src/client/response-timeout.test.ts src/shared/silent-catch-policy.test.ts "
        "src/operations/mkdir-normalize.test.ts",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('write-test', 'apply'))
    args = parser.parse_args()
    if args.mode == 'write-test':
        write_test()
    else:
        write_test()
        apply_fix()


if __name__ == '__main__':
    main()
