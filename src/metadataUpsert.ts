import type { Connection } from '@salesforce/core';

/**
 * @salesforce/core's exported `MetadataType` union predates the newer
 * External Client App metadata types — the Metadata API accepts them at
 * runtime, so callers cast a raw string via `as unknown as MetadataApiType`
 * for those. Classic types like `ConnectedApp` or `PermissionSet` are already
 * members of the real union and need no cast.
 */
export type MetadataApiType = Parameters<Connection['metadata']['read']>[0];

interface SaveResult {
  success: boolean;
  fullName: string;
  errors?: Array<{ message: string; statusCode: string }>;
}

/**
 * The Metadata API returns an array when you pass multiple names but a bare
 * object when you pass one — unwrap that to always get the single record.
 */
export function firstOrSelf<T>(result: T | T[]): T {
  // metadata.read/create/update for a single fullName always return at least
  // one element — index 0 is never actually out of bounds here.
  return Array.isArray(result) ? (result[0] as T) : result;
}

/**
 * True if `connection.metadata.read` actually found a component named
 * `fullName` — a miss comes back as a stub object with `fullName: undefined`
 * rather than throwing or returning null.
 */
export function exists(record: unknown, fullName: string): boolean {
  const r = record as { fullName?: string } | undefined;
  return Boolean(r && r.fullName === fullName);
}

/** Throws with the Salesforce-reported error details if a create/update call did not succeed. */
export function assertSaved(result: SaveResult | SaveResult[], type: string): void {
  const r = firstOrSelf(result);
  if (!r.success) {
    const messages = (r.errors ?? []).map((e) => `${e.statusCode}: ${e.message}`).join('; ');
    throw new Error(`${type} save failed for '${r.fullName}': ${messages || 'unknown error'}`);
  }
}

/**
 * Idempotently creates or updates one metadata component: reads it by
 * `fullName`, then creates it if missing or updates it if present.
 */
export async function upsertMetadata(
  connection: Connection,
  type: MetadataApiType,
  metadata: { fullName: string } & Record<string, unknown>
): Promise<{ alreadyExisted: boolean }> {
  const existing = firstOrSelf(await connection.metadata.read(type, [metadata.fullName]));
  const alreadyExisted = exists(existing, metadata.fullName);
  const save = alreadyExisted
    ? connection.metadata.update(type, metadata)
    : connection.metadata.create(type, metadata);
  assertSaved(await save, String(type));
  return { alreadyExisted };
}
