import { readFileSync } from 'node:fs';
import type { Connection } from '@salesforce/core';

export interface SetupExternalAppOptions {
  appName: string;
  label: string;
  description: string;
  contactEmail: string;
  certPemPath: string;
  preAuthUsername: string;
  permissionSetName: string;
}

export interface SetupExternalAppResult {
  created: boolean;
  consumerKey: string;
}

interface SaveResult {
  success: boolean;
  fullName: string;
  errors?: Array<{ message: string; statusCode: string }>;
}

function firstOrSelf<T>(result: T | T[]): T {
  return Array.isArray(result) ? result[0] : result;
}

function exists(record: unknown, fullName: string): boolean {
  const r = record as { fullName?: string } | undefined;
  return Boolean(r && r.fullName === fullName);
}

function assertSaved(result: SaveResult | SaveResult[], type: string): void {
  const r = firstOrSelf(result);
  if (!r.success) {
    const messages = (r.errors ?? []).map((e) => `${e.statusCode}: ${e.message}`).join('; ');
    throw new Error(`${type} save failed for '${r.fullName}': ${messages || 'unknown error'}`);
  }
}

/**
 * Idempotently creates or updates the External Client App named `appName`
 * (ExternalClientApplication + ExtlClntAppGlobalOauthSettings, which carries
 * the JWT bearer flow certificate and exposes the auto-generated consumer
 * key on read) and returns the resolved consumer key.
 */
export async function setupExternalApp(
  connection: Connection,
  options: SetupExternalAppOptions
): Promise<SetupExternalAppResult> {
  const {
    appName,
    label,
    description,
    contactEmail,
    certPemPath,
    preAuthUsername,
    permissionSetName,
  } = options;
  const certificate = readFileSync(certPemPath, 'utf8');

  const existingApp = firstOrSelf(
    await connection.metadata.read('ExternalClientApplication', [appName])
  );
  const appAlreadyExists = exists(existingApp, appName);

  const appMetadata = {
    fullName: appName,
    label,
    description,
    contactEmail,
    distributionState: 'Local',
    isProtected: false,
  };

  if (appAlreadyExists) {
    assertSaved(await connection.metadata.update('ExternalClientApplication', appMetadata), 'ExternalClientApplication');
  } else {
    assertSaved(await connection.metadata.create('ExternalClientApplication', appMetadata), 'ExternalClientApplication');
  }

  const existingOauthPlugin = firstOrSelf(
    await connection.metadata.read('ExtlClntAppOauthSettings', [appName])
  );
  const oauthPluginAlreadyExists = exists(existingOauthPlugin, appName);

  const oauthPluginSettings = {
    fullName: appName,
    externalClientApplication: appName,
    label,
    commaSeparatedOauthScopes: 'Api,RefreshToken',
  };

  if (oauthPluginAlreadyExists) {
    assertSaved(
      await connection.metadata.update('ExtlClntAppOauthSettings', oauthPluginSettings),
      'ExtlClntAppOauthSettings'
    );
  } else {
    assertSaved(
      await connection.metadata.create('ExtlClntAppOauthSettings', oauthPluginSettings),
      'ExtlClntAppOauthSettings'
    );
  }

  const existingOauth = firstOrSelf(
    await connection.metadata.read('ExtlClntAppGlobalOauthSettings', [appName])
  );
  const oauthAlreadyExists = exists(existingOauth, appName);

  const oauthSettings = {
    fullName: appName,
    externalClientApplication: appName,
    label,
    certificate,
    callbackUrl: 'https://login.salesforce.com/services/oauth2/success',
  };

  if (oauthAlreadyExists) {
    assertSaved(
      await connection.metadata.update('ExtlClntAppGlobalOauthSettings', oauthSettings),
      'ExtlClntAppGlobalOauthSettings'
    );
  } else {
    assertSaved(
      await connection.metadata.create('ExtlClntAppGlobalOauthSettings', oauthSettings),
      'ExtlClntAppGlobalOauthSettings'
    );
  }

  const existingPermSet = firstOrSelf(
    await connection.metadata.read('PermissionSet', [permissionSetName])
  );
  if (!exists(existingPermSet, permissionSetName)) {
    assertSaved(
      await connection.metadata.create('PermissionSet', {
        fullName: permissionSetName,
        label: permissionSetName,
        description: `Pre-authorizes JWT bearer login to the ${appName} external client app.`,
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

  const existingPolicy = firstOrSelf(
    await connection.metadata.read('ExtlClntAppOauthConfigurablePolicies', [appName])
  );
  const policyMetadata = {
    fullName: appName,
    externalClientApplication: appName,
    label,
    permittedUsersPolicyType: 'AdminApprovedPreAuthorized',
    commaSeparatedPermissionSet: permissionSetName,
  };

  if (exists(existingPolicy, appName)) {
    assertSaved(
      await connection.metadata.update('ExtlClntAppOauthConfigurablePolicies', policyMetadata),
      'ExtlClntAppOauthConfigurablePolicies'
    );
  } else {
    assertSaved(
      await connection.metadata.create('ExtlClntAppOauthConfigurablePolicies', policyMetadata),
      'ExtlClntAppOauthConfigurablePolicies'
    );
  }

  const resolved = firstOrSelf(
    await connection.metadata.read('ExtlClntAppGlobalOauthSettings', [appName])
  ) as { consumerKey?: string } | undefined;

  if (!resolved?.consumerKey) {
    throw new Error(
      `ExtlClntAppGlobalOauthSettings for '${appName}' has no consumerKey after create/update.`
    );
  }

  return { created: !appAlreadyExists, consumerKey: resolved.consumerKey };
}
