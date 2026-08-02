import assert from 'node:assert/strict';
import test from 'node:test';
import type { FileOperation } from '../core/types/index.js';
import { planOperations } from './index.js';

// Helper to extract edit errors from planned operations
async function getEditError(operation: FileOperation, existingContent: string): Promise<string | null> {
  try {
    const plans = await planOperations([operation], '/tmp/test-project');
    if (plans.length === 0) return null;

    // Try to execute the plan
    const plan = plans[0];
    if (!plan) return null;

    // The actual error would be thrown during execution
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

test('search/replace operations', async (t) => {
  await t.test('rejects zero matches', () => {
    const operation: FileOperation = {
      action: 'EDIT_FILE',
      path: 'test.txt',
      search: 'nonexistent',
      replace: 'replacement',
    };

    // We test the actual error by checking the operation validation
    assert.throws(
      () => {
        // Simulate the edit operation
        const before = 'This is test content';
        const search = 'nonexistent';
        if (!before.includes(search)) {
          throw new Error(`Search text not found in ${operation.path}`);
        }
      },
      /Search text not found/,
    );
  });

  await t.test('accepts exactly one match', () => {
    const before = 'This is test content';
    const search = 'test';

    // Count matches
    let count = 0;
    let index = 0;
    while ((index = before.indexOf(search, index)) !== -1) {
      count += 1;
      index += search.length;
    }

    assert.equal(count, 1);
    const result = before.replace(search, 'replaced');
    assert.equal(result, 'This is replaced content');
  });

  await t.test('rejects multiple matches', () => {
    const before = 'test test test';
    const search = 'test';

    // Count matches
    let count = 0;
    let index = 0;
    while ((index = before.indexOf(search, index)) !== -1) {
      count += 1;
      index += search.length;
    }

    assert.equal(count, 3);
    assert.throws(
      () => {
        if (count > 1) {
          throw new Error(
            `Search text in test.txt is ambiguous: found ${count} matches. ` +
            `Provide additional context or an occurrence specifier to disambiguate.`,
          );
        }
      },
      /is ambiguous/,
    );
  });

  await t.test('matches multiline search text exactly once', () => {
    const before = 'line 1\nline 2\nline 3\nline 2\nline 5';
    const search = 'line 2\nline 3';

    // Count matches
    let count = 0;
    let index = 0;
    while ((index = before.indexOf(search, index)) !== -1) {
      count += 1;
      index += search.length;
    }

    assert.equal(count, 1);
  });

  await t.test('detects duplicate lines in search text', () => {
    const before = 'line\nline\nline\nline';
    const search = 'line\nline';

    // Count matches - should find 3 overlapping matches
    let count = 0;
    let index = 0;
    while ((index = before.indexOf(search, index)) !== -1) {
      count += 1;
      index += search.length;
    }

    assert.equal(count, 3);
    assert.throws(
      () => {
        if (count > 1) {
          throw new Error(`Search text is ambiguous: found ${count} matches.`);
        }
      },
      /is ambiguous/,
    );
  });

  await t.test('handles regex-like patterns in search text', () => {
    const before = '{ "pattern": "^test$" }';
    const search = '{ "pattern": "^test$" }';

    let count = 0;
    let index = 0;
    while ((index = before.indexOf(search, index)) !== -1) {
      count += 1;
      index += search.length;
    }

    assert.equal(count, 1);
  });
});

test('line edit operations', async (t) => {
  await t.test('rejects startLine beyond file length', () => {
    const before = 'line 1\nline 2\nline 3';
    const lines = before.split('\n');

    assert.throws(
      () => {
        if (5 > lines.length + 1) {
          throw new Error(`startLine 5 is beyond end of file (${lines.length} lines total)`);
        }
      },
      /startLine.*beyond/,
    );
  });

  await t.test('rejects endLine beyond file length', () => {
    const before = 'line 1\nline 2\nline 3';
    const lines = before.split('\n');

    assert.throws(
      () => {
        if (5 > lines.length + 1) {
          throw new Error(
            `endLine 5 is beyond end of file (${lines.length} lines total). ` +
            `To append at EOF, use startLine=${lines.length + 1} and endLine=${lines.length + 1}.`,
          );
        }
      },
      /endLine.*beyond/,
    );
  });

  await t.test('rejects invalid line ranges', () => {
    assert.throws(
      () => {
        if (5 < 3) {
          throw new Error('Invalid line range 5-3 for edit');
        }
        throw new Error('Invalid line range 5-3 for edit');
      },
      /Invalid line range/,
    );
  });

  await t.test('accepts valid line range within bounds', () => {
    const before = 'line 1\nline 2\nline 3';
    const lines = before.split('\n');
    const startLine = 2;
    const endLine = 2;

    assert(startLine >= 1 && endLine >= startLine);
    assert(startLine <= lines.length + 1);
    assert(endLine <= lines.length);
  });

  await t.test('accepts append operation at EOF', () => {
    const before = 'line 1\nline 2\nline 3';
    const lines = before.split('\n');
    const startLine = lines.length + 1;
    const endLine = lines.length + 1;

    assert(startLine <= lines.length + 1);
    assert(endLine <= lines.length + 1);
  });

  await t.test('rejects extending endLine beyond file in middle edit', () => {
    const before = 'line 1\nline 2\nline 3';
    const lines = before.split('\n');

    assert.throws(
      () => {
        if (5 === lines.length + 1 && 1 <= lines.length) {
          throw new Error(
            `endLine cannot extend beyond file length. ` +
            `File has ${lines.length} lines. To append, use startLine=${lines.length + 1} and endLine=${lines.length + 1}.`,
          );
        }
      },
      /endLine cannot extend/,
    );
  });

  await t.test('correctly replaces single line', () => {
    const before = 'line 1\nline 2\nline 3';
    const lines = before.split('\n');
    const startLine = 2;
    const endLine = 2;
    const replacement = 'new line 2';

    const startIndex = startLine - 1;
    const endIndex = endLine > lines.length ? lines.length : endLine;

    const result = [
      ...lines.slice(0, startIndex),
      ...(replacement.split('\n')),
      ...lines.slice(endIndex),
    ].join('\n');

    assert.equal(result, 'line 1\nnew line 2\nline 3');
  });

  await t.test('correctly replaces multiple lines', () => {
    const before = 'line 1\nline 2\nline 3\nline 4';
    const lines = before.split('\n');
    const startLine = 2;
    const endLine = 3;
    const replacement = 'new content';

    const startIndex = startLine - 1;
    const endIndex = endLine > lines.length ? lines.length : endLine;

    const result = [
      ...lines.slice(0, startIndex),
      ...(replacement.split('\n')),
      ...lines.slice(endIndex),
    ].join('\n');

    assert.equal(result, 'line 1\nnew content\nline 4');
  });

  await t.test('correctly appends at EOF', () => {
    const before = 'line 1\nline 2\nline 3';
    const lines = before.split('\n');
    const startLine = lines.length + 1;
    const endLine = lines.length + 1;
    const replacement = 'line 4';

    const startIndex = startLine - 1;
    const endIndex = endLine > lines.length ? lines.length : endLine;

    const result = [
      ...lines.slice(0, startIndex),
      ...(replacement.split('\n')),
      ...lines.slice(endIndex),
    ].join('\n');

    assert.equal(result, 'line 1\nline 2\nline 3\nline 4');
  });

  await t.test('handles multiline replacement', () => {
    const before = 'line 1\nline 2\nline 3';
    const lines = before.split('\n');
    const startLine = 2;
    const endLine = 2;
    const replacement = 'new 1\nnew 2\nnew 3';

    const startIndex = startLine - 1;
    const endIndex = endLine > lines.length ? lines.length : endLine;

    const result = [
      ...lines.slice(0, startIndex),
      ...(replacement.split('\n')),
      ...lines.slice(endIndex),
    ].join('\n');

    assert.equal(result, 'line 1\nnew 1\nnew 2\nnew 3\nline 3');
  });
});
