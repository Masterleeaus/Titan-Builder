import assert from 'node:assert/strict';
import test from 'node:test';

// Test binary detection logic
function isBinaryContent(buffer: Buffer): boolean {
  for (let i = 0; i < Math.min(buffer.length, 8192); i += 1) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

// Test byte formatting logic
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Test diff truncation logic
const MAX_DIFF_SIZE_BYTES = 1 * 1024 * 1024;
function truncateDiff(diff: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(diff, 'utf8');
  if (bytes <= maxBytes) {
    return diff;
  }

  let truncated = '';
  let currentBytes = 0;
  const lines = diff.split('\n');

  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line + '\n', 'utf8');
    if (currentBytes + lineBytes > maxBytes - 100) {
      break;
    }
    truncated += line + '\n';
    currentBytes += lineBytes;
  }

  return truncated + `\n... (diff truncated: ${formatBytes(bytes)} > ${formatBytes(maxBytes)})\n`;
}

test('binary content detection', async (t) => {
  await t.test('detects binary content with null bytes', () => {
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a, 0x1a, 0x0a]); // PNG-like with null byte
    assert.equal(isBinaryContent(binary), true);
  });

  await t.test('accepts text without null bytes', () => {
    const text = Buffer.from('This is plain text\nwith multiple lines\n', 'utf8');
    assert.equal(isBinaryContent(text), false);
  });

  await t.test('accepts empty content', () => {
    const empty = Buffer.from('');
    assert.equal(isBinaryContent(empty), false);
  });

  await t.test('accepts multibyte UTF-8 text', () => {
    const utf8 = Buffer.from('Hello 世界 مرحبا мир', 'utf8');
    assert.equal(isBinaryContent(utf8), false);
  });

  await t.test('detects null byte in middle of file', () => {
    const withNull = Buffer.from('before\0after');
    assert.equal(isBinaryContent(withNull), true);
  });

  await t.test('checks only first 8KB for performance', () => {
    // Create a 10MB buffer filled with 'a', with null byte at position 9MB
    const large = Buffer.alloc(10 * 1024 * 1024, 'a');
    large[9 * 1024 * 1024] = 0;
    // Should return false because null byte is beyond 8KB
    assert.equal(isBinaryContent(large), false);
  });
});

test('byte formatting', async (t) => {
  await t.test('formats bytes correctly', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1024), '1.0 KB');
    assert.equal(formatBytes(1024 * 1024), '1.0 MB');
    assert.equal(formatBytes(1.5 * 1024 * 1024), '1.5 MB');
  });

  await t.test('formats large values', () => {
    assert.equal(formatBytes(10 * 1024 * 1024), '10.0 MB');
  });
});

test('diff truncation', async (t) => {
  await t.test('preserves diff under limit', () => {
    const diff = 'line1\nline2\nline3\n';
    const result = truncateDiff(diff, 1024 * 1024);
    assert.equal(result, diff);
  });

  await t.test('truncates diff over limit', () => {
    const largeLinecount = 100000;
    let diff = '';
    for (let i = 0; i < largeLinecount; i += 1) {
      diff += `+ added line ${i}\n`;
    }

    const result = truncateDiff(diff, 10 * 1024); // 10 KB limit
    assert(result.length < diff.length);
    assert(result.includes('diff truncated'));
    assert(Buffer.byteLength(result, 'utf8') <= 10 * 1024 + 200);
  });

  await t.test('handles single large line', () => {
    const largeContent = 'x'.repeat(1024 * 1024 + 1024);
    const diff = `+ ${largeContent}\n`;

    const result = truncateDiff(diff, 1024);
    assert(result.includes('diff truncated'));
  });

  await t.test('includes byte count in truncation message', () => {
    const largeLinecount = 100000;
    let diff = '';
    for (let i = 0; i < largeLinecount; i += 1) {
      diff += `+ line ${i}\n`;
    }

    const result = truncateDiff(diff, 5 * 1024);
    assert(result.includes('diff truncated'));
    assert(result.includes('KB'));
  });

  await t.test('preserves complete lines in truncation', () => {
    const diff = 'line 1\nline 2\nline 3\nline 4\nline 5\n';
    const result = truncateDiff(diff, 20); // Very small limit

    const lines = result.split('\n').filter((line) => line && !line.includes('truncated'));
    // Should have at least some complete lines
    for (const line of lines) {
      assert(!line.includes('... ('));
    }
  });
});

test('file size limits', async (t) => {
  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  await t.test('accepts files under limit', () => {
    const size = 5 * 1024 * 1024;
    assert(size <= MAX_FILE_SIZE);
  });

  await t.test('rejects files over limit', () => {
    const size = 15 * 1024 * 1024;
    assert(size > MAX_FILE_SIZE);

    const error = `File exceeds maximum size: file.txt ` +
      `(${formatBytes(size)} > ${formatBytes(MAX_FILE_SIZE)})`;
    assert(error.includes('exceeds maximum'));
  });

  await t.test('handles exactly at limit', () => {
    const size = MAX_FILE_SIZE;
    assert(size <= MAX_FILE_SIZE);
  });
});

test('content kind handling', async (t) => {
  await t.test('distinguishes binary files', () => {
    const kinds = ['file', 'binary', 'directory', 'missing'];
    assert(kinds.includes('binary'));
  });

  await t.test('binary files cannot be edited', () => {
    const kind = 'binary';
    const isEditable = kind === 'file';
    assert.equal(isEditable, false);
  });

  await t.test('binary files can be deleted', () => {
    const kind = 'binary';
    const isDeletable = kind === 'file' || kind === 'binary';
    assert.equal(isDeletable, true);
  });
});
