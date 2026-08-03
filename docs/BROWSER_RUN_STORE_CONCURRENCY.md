# Browser Run Store Concurrency Model

This document explains how the browser run store handles concurrent access and why it's safe from race conditions.

## Architecture

The browser run store uses a **two-layer architecture**:

1. **In-Memory Layer**: A `Map<runId, BrowserRunRecord>` that holds all active browser run records
2. **Persistence Layer**: File-based storage (JSON files) for durability

## Concurrency Safety

### JavaScript Event Loop Guarantees

The store is thread-safe because:
- **Node.js runs on a single-threaded event loop**: All operations complete atomically from the perspective of other JavaScript code
- **File operations are async but non-blocking**: Multiple file I/O operations can be in-flight simultaneously, but they don't corrupt shared state because the in-memory Map is protected by event loop serialization

### Protected Operations

All store methods follow this pattern:

```typescript
async transition(runId, status) {
  const record = await requireRecord(runId);      // Read from in-memory Map
  const updated = { ...record, status };           // Create new object
  records.set(runId, updated);                     // Atomic write to Map (single event loop cycle)
  await persist(updated);                          // Async file write (doesn't interfere with Map)
}
```

Even if two `transition` calls happen "simultaneously":
1. Both await `requireRecord()`, which runs to completion (event loop serialization)
2. First one calls `records.set()` (atomic)
3. Second one calls `records.set()` (atomic)
4. Both file writes happen, but the last write wins (idempotent update)

### Atomic File Operations

File persistence uses `writeAtomicJson()` which:
- Writes to a temporary file
- Renames it into place (atomic on most filesystems)
- Prevents partial/corrupt JSON files

### Single Load Promise

The `loadPromise` ensures that initial load from disk happens exactly once, even with concurrent load requests:

```typescript
loadPromise ??= loadPersistedRecords(records, runsDir);  // Only initializes once
await loadPromise;  // All waiters get the same promise
```

## Why No Explicit Locking Is Needed

Traditional locking (mutexes, file locks) is not needed because:

1. **Event loop serialization** makes operations atomic
2. **In-memory-first design** means the disk is secondary storage, not the source of truth
3. **Atomic file writes** prevent corruption
4. **Idempotent updates** mean the last write to disk is correct regardless of ordering

## Potential Improvements (Future)

If requirements change, consider:
- **Advisory file locks** if multiple processes access the same store
- **Queuing with serial execution** if operation ordering becomes critical
- **Transaction logging** for audit trails
- **Optimistic locking** with version numbers if conflicts need handling

## Testing

Concurrency is validated through:
- `browser-run-store.test.ts` unit tests
- Integration tests with concurrent operations
- CI/CD runs to catch race conditions
