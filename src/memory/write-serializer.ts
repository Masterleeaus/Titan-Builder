import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';

export interface SerializedWriteOperation {
  filePath: string;
  content: string;
  tempPath?: string;
}

export interface ReadModifyWriteOperation {
  filePath: string;
  transform: (currentContent: string | null) => Promise<string>;
}

type AnyOperation = SerializedWriteOperation | ReadModifyWriteOperation;

interface PendingWrite {
  operation: AnyOperation;
  resolve: () => void;
  reject: (error: Error) => void;
}

function isReadModifyWrite(op: AnyOperation): op is ReadModifyWriteOperation {
  return 'transform' in op;
}

class AsyncQueue {
  private queue: PendingWrite[] = [];
  private processing = false;

  async enqueue(operation: AnyOperation): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ operation, resolve, reject });
      this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    while (this.queue.length > 0) {
      const pending = this.queue.shift();
      if (!pending) break;

      try {
        if (isReadModifyWrite(pending.operation)) {
          await this.processReadModifyWrite(pending.operation);
        } else {
          await this.processWrite(pending.operation);
        }
        pending.resolve();
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    this.processing = false;
  }

  private async processWrite(operation: SerializedWriteOperation): Promise<void> {
    const tempPath = operation.tempPath || this.generateTempPath(operation.filePath);
    const dir = path.dirname(tempPath);
    await mkdir(dir, { recursive: true });
    await writeFile(tempPath, operation.content, 'utf8');
    await rename(tempPath, operation.filePath);
  }

  private async processReadModifyWrite(operation: ReadModifyWriteOperation): Promise<void> {
    let currentContent: string | null = null;
    try {
      currentContent = await readFile(operation.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    const newContent = await operation.transform(currentContent);
    const tempPath = this.generateTempPath(operation.filePath);
    const dir = path.dirname(tempPath);
    await mkdir(dir, { recursive: true });
    await writeFile(tempPath, newContent, 'utf8');
    await rename(tempPath, operation.filePath);
  }

  private generateTempPath(filePath: string): string {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const uniqueId = crypto.randomUUID().slice(0, 8);
    return path.join(dir, `.${base}.${uniqueId}.tmp`);
  }
}

const writeQueues = new Map<string, AsyncQueue>();

function getOrCreateQueue(projectRoot: string): AsyncQueue {
  let queue = writeQueues.get(projectRoot);
  if (!queue) {
    queue = new AsyncQueue();
    writeQueues.set(projectRoot, queue);
  }
  return queue;
}

export async function serializedWrite(projectRoot: string, operation: SerializedWriteOperation): Promise<void> {
  const queue = getOrCreateQueue(projectRoot);
  await queue.enqueue(operation);
}

export async function serializedReadModifyWrite(
  projectRoot: string,
  operation: ReadModifyWriteOperation,
): Promise<void> {
  const queue = getOrCreateQueue(projectRoot);
  await queue.enqueue(operation);
}

export function clearQueueForProject(projectRoot: string): void {
  writeQueues.delete(projectRoot);
}

export { AsyncQueue };
