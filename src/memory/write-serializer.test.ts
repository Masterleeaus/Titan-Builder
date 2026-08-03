import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, rmdir } from 'node:fs/promises';
import path from 'node:path';
import fs from 'fs-extra';
import { serializedWrite, serializedReadModifyWrite, clearQueueForProject } from './write-serializer.ts';

const testDir = '/tmp/write-serializer-test';

async function setupTestDir(): Promise<string> {
  await fs.ensureDir(testDir);
  return testDir;
}

async function cleanupTestDir(): Promise<void> {
  await fs.remove(testDir);
}

test('write serializer', async (t) => {
  await t.test('performs a simple write operation', async () => {
    const testRoot = await setupTestDir();
    try {
      const filePath = path.join(testRoot, 'test.json');
      await serializedWrite(testRoot, {
        filePath,
        content: '{"key": "value"}\n',
      });

      const content = await readFile(filePath, 'utf8');
      assert.equal(content, '{"key": "value"}\n');
    } finally {
      clearQueueForProject(testRoot);
      await cleanupTestDir();
    }
  });

  await t.test('serializes concurrent writes in order', async () => {
    const testRoot = await setupTestDir();
    try {
      const filePath = path.join(testRoot, 'counter.txt');
      const numbers: number[] = [];

      const writes = Array.from({ length: 10 }, (_, i) =>
        serializedWrite(testRoot, {
          filePath,
          content: String(i),
        }),
      );

      await Promise.all(writes);

      const content = await readFile(filePath, 'utf8');
      assert.equal(content, '9');
    } finally {
      clearQueueForProject(testRoot);
      await cleanupTestDir();
    }
  });

  await t.test('performs atomic read-modify-write', async () => {
    const testRoot = await setupTestDir();
    try {
      const filePath = path.join(testRoot, 'counter.json');

      await serializedWrite(testRoot, {
        filePath,
        content: '[1]\n',
      });

      await serializedReadModifyWrite(testRoot, {
        filePath,
        transform: async (currentContent: string | null): Promise<string> => {
          const data = currentContent ? JSON.parse(currentContent) : [];
          data.push(2);
          return `${JSON.stringify(data)}\n`;
        },
      });

      const content = await readFile(filePath, 'utf8');
      const data = JSON.parse(content) as number[];
      assert.deepEqual(data, [1, 2]);
    } finally {
      clearQueueForProject(testRoot);
      await cleanupTestDir();
    }
  });

  await t.test('handles concurrent read-modify-write operations', async () => {
    const testRoot = await setupTestDir();
    try {
      const filePath = path.join(testRoot, 'array.json');

      await serializedWrite(testRoot, {
        filePath,
        content: '[]\n',
      });

      const operations = Array.from({ length: 5 }, (_, i) =>
        serializedReadModifyWrite(testRoot, {
          filePath,
          transform: async (currentContent: string | null): Promise<string> => {
            const data = currentContent ? JSON.parse(currentContent) : [];
            data.push(i);
            return `${JSON.stringify(data)}\n`;
          },
        }),
      );

      await Promise.all(operations);

      const content = await readFile(filePath, 'utf8');
      const data = JSON.parse(content) as number[];
      assert.equal(data.length, 5);
      assert.deepEqual(data, [0, 1, 2, 3, 4]);
    } finally {
      clearQueueForProject(testRoot);
      await cleanupTestDir();
    }
  });

  await t.test('handles read-modify-write on non-existent file', async () => {
    const testRoot = await setupTestDir();
    try {
      const filePath = path.join(testRoot, 'newfile.json');

      await serializedReadModifyWrite(testRoot, {
        filePath,
        transform: async (currentContent: string | null): Promise<string> => {
          assert.equal(currentContent, null);
          return '[]\n';
        },
      });

      const content = await readFile(filePath, 'utf8');
      assert.equal(content, '[]\n');
    } finally {
      clearQueueForProject(testRoot);
      await cleanupTestDir();
    }
  });

  await t.test('creates parent directories before writing', async () => {
    const testRoot = await setupTestDir();
    try {
      const filePath = path.join(testRoot, 'nested', 'deep', 'file.txt');

      await serializedWrite(testRoot, {
        filePath,
        content: 'test',
      });

      const content = await readFile(filePath, 'utf8');
      assert.equal(content, 'test');
    } finally {
      clearQueueForProject(testRoot);
      await cleanupTestDir();
    }
  });

  await t.test('preserves existing file on error', async () => {
    const testRoot = await setupTestDir();
    try {
      const filePath = path.join(testRoot, 'existing.txt');

      await serializedWrite(testRoot, {
        filePath,
        content: 'original',
      });

      try {
        await serializedReadModifyWrite(testRoot, {
          filePath,
          transform: async (): Promise<string> => {
            throw new Error('Transformation failed');
          },
        });
      } catch (e) {
        // Expected
      }

      const content = await readFile(filePath, 'utf8');
      assert.equal(content, 'original');
    } finally {
      clearQueueForProject(testRoot);
      await cleanupTestDir();
    }
  });

  await t.test('handles many concurrent operations stress test', async () => {
    const testRoot = await setupTestDir();
    try {
      const filePath = path.join(testRoot, 'stress.json');

      await serializedWrite(testRoot, {
        filePath,
        content: '{"count": 0}\n',
      });

      const operations = Array.from({ length: 100 }, () =>
        serializedReadModifyWrite(testRoot, {
          filePath,
          transform: async (currentContent: string | null): Promise<string> => {
            const data = currentContent ? JSON.parse(currentContent) : { count: 0 };
            data.count += 1;
            return `${JSON.stringify(data)}\n`;
          },
        }),
      );

      await Promise.all(operations);

      const content = await readFile(filePath, 'utf8');
      const data = JSON.parse(content) as { count: number };
      assert.equal(data.count, 100);
    } finally {
      clearQueueForProject(testRoot);
      await cleanupTestDir();
    }
  });

  await t.test('maintains separate queues per project root', async () => {
    const testRoot1 = path.join(testDir, 'project1');
    const testRoot2 = path.join(testDir, 'project2');

    try {
      await fs.ensureDir(testRoot1);
      await fs.ensureDir(testRoot2);

      const file1 = path.join(testRoot1, 'file.txt');
      const file2 = path.join(testRoot2, 'file.txt');

      await Promise.all([
        serializedWrite(testRoot1, { filePath: file1, content: 'project1' }),
        serializedWrite(testRoot2, { filePath: file2, content: 'project2' }),
      ]);

      const content1 = await readFile(file1, 'utf8');
      const content2 = await readFile(file2, 'utf8');

      assert.equal(content1, 'project1');
      assert.equal(content2, 'project2');
    } finally {
      clearQueueForProject(testRoot1);
      clearQueueForProject(testRoot2);
      await cleanupTestDir();
    }
  });
});
