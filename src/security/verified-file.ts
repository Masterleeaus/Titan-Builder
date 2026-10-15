import { constants, type BigIntStats } from 'node:fs';
import {
  lstat,
  open,
  type FileHandle,
} from 'node:fs/promises';

export interface FileIdentity {
  device: string;
  inode: string;
}

export interface OpenVerifiedRegularFileOptions {
  /** Deterministic race hook used by security regression tests. */
  afterInitialInspection?: () => Promise<void> | void;
  /** Deterministic mutation hook used by security regression tests. */
  beforeRead?: () => Promise<void> | void;
}

export interface VerifiedRegularFile {
  readonly path: string;
  readonly identity: FileIdentity;
  readonly mode: number;
  readonly size: bigint;
  readBuffer(): Promise<Buffer>;
  close(): Promise<void>;
}

export class VerifiedFileError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = 'VerifiedFileError';
  }
}

export async function openVerifiedRegularFile(
  filePath: string,
  options: OpenVerifiedRegularFileOptions = {},
): Promise<VerifiedRegularFile> {
  const initial = await inspectPath(filePath, 'initial inspection');
  assertRegularPath(initial, filePath);
  const approvedIdentity = identityOf(initial);

  await options.afterInitialInspection?.();

  let handle: FileHandle | undefined;
  try {
    handle = await open(filePath, readOnlyNoFollowFlags());
    const opened = await handle.stat({ bigint: true });
    assertRegularHandle(opened, filePath);

    const current = await inspectPath(filePath, 'post-open inspection');
    assertRegularPath(current, filePath);
    assertSameIdentity(approvedIdentity, identityOf(opened), filePath, 'opened object');
    assertSameIdentity(approvedIdentity, identityOf(current), filePath, 'current pathname');

    let closed = false;
    let reading = false;
    const verifiedHandle = handle;

    return {
      path: filePath,
      identity: approvedIdentity,
      mode: Number(opened.mode),
      size: opened.size,
      async readBuffer(): Promise<Buffer> {
        if (closed) {
          throw new VerifiedFileError(`Verified file handle is already closed: ${filePath}`);
        }
        if (reading) {
          throw new VerifiedFileError(`Concurrent reads are not allowed for verified file: ${filePath}`);
        }
        reading = true;
        try {
          const before = await verifiedHandle.stat({ bigint: true });
          assertRegularHandle(before, filePath);
          assertSameIdentity(approvedIdentity, identityOf(before), filePath, 'pre-read handle');

          await options.beforeRead?.();

          const bytes = await readExactBuffer(verifiedHandle, before.size, filePath);
          const after = await verifiedHandle.stat({ bigint: true });
          assertRegularHandle(after, filePath);
          assertSameIdentity(approvedIdentity, identityOf(after), filePath, 'post-read handle');

          const currentPath = await inspectPath(filePath, 'post-read inspection');
          assertRegularPath(currentPath, filePath);
          assertSameIdentity(approvedIdentity, identityOf(currentPath), filePath, 'post-read pathname');

          if (!sameRevision(before, after)) {
            throw new VerifiedFileError(`Verified file changed while it was being read: ${filePath}`);
          }
          return bytes;
        } finally {
          reading = false;
        }
      },
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        await verifiedHandle.close();
      },
    };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error instanceof VerifiedFileError) throw error;
    throw new VerifiedFileError(
      `Verified no-follow open failed because the file changed or became a symbolic link: ${filePath}`,
      { cause: error },
    );
  }
}

export function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function readOnlyNoFollowFlags(): number {
  const noFollow = process.platform === 'win32'
    ? 0
    : typeof constants.O_NOFOLLOW === 'number'
      ? constants.O_NOFOLLOW
      : 0;
  return constants.O_RDONLY | noFollow;
}

async function inspectPath(filePath: string, phase: string): Promise<BigIntStats> {
  try {
    return await lstat(filePath, { bigint: true });
  } catch (error) {
    throw new VerifiedFileError(
      `Verified file changed during ${phase}: ${filePath}`,
      { cause: error },
    );
  }
}

function assertRegularPath(stats: BigIntStats, filePath: string): void {
  if (stats.isSymbolicLink()) {
    throw new VerifiedFileError(`Verified file path is a symbolic link: ${filePath}`);
  }
  if (!stats.isFile()) {
    throw new VerifiedFileError(`Verified file path is not a regular file: ${filePath}`);
  }
}

function assertRegularHandle(stats: BigIntStats, filePath: string): void {
  if (!stats.isFile()) {
    throw new VerifiedFileError(`Verified file handle is not a regular file: ${filePath}`);
  }
}

function identityOf(stats: BigIntStats): FileIdentity {
  return {
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
  };
}

function assertSameIdentity(
  expected: FileIdentity,
  actual: FileIdentity,
  filePath: string,
  phase: string,
): void {
  if (!sameFileIdentity(expected, actual)) {
    throw new VerifiedFileError(`Verified file identity changed at ${phase}: ${filePath}`);
  }
}

function sameRevision(left: BigIntStats, right: BigIntStats): boolean {
  return (
    sameFileIdentity(identityOf(left), identityOf(right))
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
  );
}

async function readExactBuffer(
  handle: FileHandle,
  size: bigint,
  filePath: string,
): Promise<Buffer> {
  if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new VerifiedFileError(`Verified file is too large to read safely: ${filePath}`);
  }
  const byteLength = Number(size);
  const buffer = Buffer.allocUnsafe(byteLength);
  let offset = 0;
  while (offset < byteLength) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      byteLength - offset,
      offset,
    );
    if (bytesRead === 0) {
      throw new VerifiedFileError(`Verified file changed while it was being read: ${filePath}`);
    }
    offset += bytesRead;
  }
  return buffer;
}
