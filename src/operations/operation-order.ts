import type { FileOperation } from '../core/types/index.js';

/**
 * Preserve the operation sequence approved by the user.
 *
 * Safe command normalization (for example, converting an in-place mkdir-only
 * command into CREATE_FOLDER operations) happens before this function and
 * retains the command's original position. File operations already create
 * their required parent directories at execution time, so global action-type
 * sorting is neither necessary nor safe.
 */
export function preserveOperationOrder(operations: FileOperation[]): FileOperation[] {
  return [...operations];
}

/** @deprecated Use preserveOperationOrder. Kept for compatibility with callers outside this package. */
export const sortOperationsByExecutionOrder = preserveOperationOrder;
