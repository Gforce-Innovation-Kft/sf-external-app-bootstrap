import type { Connection } from '@salesforce/core';
import { assertSaved, exists, firstOrSelf } from './metadataUpsert';

export interface EnsurePreAuthPermissionSetOptions {
  permissionSetName: string;
  description: string;
  preAuthUsername: string;
}

/**
 * Both the External Client App and the classic Connected App pre-authorize
 * the same way: a dedicated permission set, assigned to `preAuthUsername`,
 * that the app's OAuth policy references by name. Creates the permission set
 * if missing and assigns it to the user if not already assigned.
 */
export async function ensurePreAuthPermissionSet(
  connection: Connection,
  options: EnsurePreAuthPermissionSetOptions
): Promise<void> {
  const { permissionSetName, description, preAuthUsername } = options;

  const existingPermSet = firstOrSelf(
    await connection.metadata.read('PermissionSet', [permissionSetName])
  );
  if (!exists(existingPermSet, permissionSetName)) {
    assertSaved(
      await connection.metadata.create('PermissionSet', {
        fullName: permissionSetName,
        label: permissionSetName,
        description,
      }),
      'PermissionSet'
    );
  }

  const preAuthUserId = (
    await connection.query<{ Id: string }>(
      `SELECT Id FROM User WHERE Username = '${preAuthUsername}'`
    )
  ).records[0]?.Id;
  if (!preAuthUserId) {
    throw new Error(`No user found with username '${preAuthUsername}'.`);
  }

  const permSetId = (
    await connection.query<{ Id: string }>(
      `SELECT Id FROM PermissionSet WHERE Name = '${permissionSetName}'`
    )
  ).records[0]?.Id;
  if (!permSetId) {
    throw new Error(`PermissionSet '${permissionSetName}' was created but is not queryable yet.`);
  }

  const alreadyAssigned = await connection.query<{ Id: string }>(
    `SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = '${preAuthUserId}' ` +
      `AND PermissionSetId = '${permSetId}'`
  );
  if (alreadyAssigned.totalSize === 0) {
    await connection.sobject('PermissionSetAssignment').create({
      AssigneeId: preAuthUserId,
      PermissionSetId: permSetId,
    });
  }
}
