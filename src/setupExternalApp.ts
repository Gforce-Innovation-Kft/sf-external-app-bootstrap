import { readFileSync } from 'node:fs';
import type { Connection } from '@salesforce/core';

/**
 * @salesforce/core's exported `MetadataType` union predates these External
 * Client App metadata types — the Metadata API accepts them at runtime, so a
 * narrow cast (derived from the real method signature, not `any`) is needed.
 */
type MetadataApiType = Parameters<Connection['metadata']['read']>[0];
const EXTERNAL_CLIENT_APPLICATION = 'ExternalClientApplication' as unknown as MetadataApiType;
const EXTL_CLNT_APP_OAUTH_SETTINGS = 'ExtlClntAppOauthSettings' as unknown as MetadataApiType;
const EXTL_CLNT_APP_GLOBAL_OAUTH_SETTINGS = 'ExtlClntAppGlobalOauthSettings' as unknown as MetadataApiType;
const EXTL_CLNT_APP_OAUTH_CONFIGURABLE_POLICIES =
  'ExtlClntAppOauthConfigurablePolicies' as unknown as MetadataApiType;

/** Certificate is supplied as exactly one of a file path or its raw PEM content. */
export type CertificateInput = { certPemPath: string; certPem?: never } | { certPem: string; certPemPath?: never };

export type SetupExternalAppOptions = {
  /** The only input without a sensible default — everything else derives from it. */
  appName: string;
  /** Username to pre-authorize for JWT login; org-specific, no default possible. */
  preAuthUsername: string;
  /** Defaults to `appName`. */
  label?: string;
  /** Defaults to a generic bootstrap description mentioning `appName`. */
  description?: string;
  /** Defaults to gabor.demeter@gforceinnovation.com. */
  contactEmail?: string;
  /** Defaults to the standard Salesforce login success callback. */
  oauthCallbackUrl?: string;
  /** Defaults to `${appName}_Preauthorized`. */
  permissionSetName?: string;
} & CertificateInput;

export interface SetupExternalAppResult {
  created: boolean;
  consumerKey: string;
}

const DEFAULT_CONTACT_EMAIL = 'gabor.demeter@gforceinnovation.com';
const DEFAULT_OAUTH_CALLBACK_URL = 'https://login.salesforce.com/services/oauth2/success';

function resolveCertificatePem(options: SetupExternalAppOptions): string {
  if ('certPem' in options && options.certPem !== undefined) {
    return options.certPem;
  }
  if ('certPemPath' in options && options.certPemPath !== undefined) {
    return readFileSync(options.certPemPath, 'utf8');
  }
  throw new Error('Provide either certPem or certPemPath.');
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
  const { appName, preAuthUsername } = options;
  const label = options.label ?? appName;
  const description = options.description ?? `Bootstrap external client app '${appName}' via @salesforce/core.`;
  const contactEmail = options.contactEmail ?? DEFAULT_CONTACT_EMAIL;
  const oauthCallbackUrl = options.oauthCallbackUrl ?? DEFAULT_OAUTH_CALLBACK_URL;
  const permissionSetName = options.permissionSetName ?? `${appName}_Preauthorized`;
  const certificate = resolveCertificatePem(options);

  const existingApp = firstOrSelf(
    await connection.metadata.read(EXTERNAL_CLIENT_APPLICATION, [appName])
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
    assertSaved(await connection.metadata.update(EXTERNAL_CLIENT_APPLICATION, appMetadata), EXTERNAL_CLIENT_APPLICATION);
  } else {
    assertSaved(await connection.metadata.create(EXTERNAL_CLIENT_APPLICATION, appMetadata), EXTERNAL_CLIENT_APPLICATION);
  }

  const existingOauthPlugin = firstOrSelf(
    await connection.metadata.read(EXTL_CLNT_APP_OAUTH_SETTINGS, [appName])
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
      await connection.metadata.update(EXTL_CLNT_APP_OAUTH_SETTINGS, oauthPluginSettings),
      EXTL_CLNT_APP_OAUTH_SETTINGS
    );
  } else {
    assertSaved(
      await connection.metadata.create(EXTL_CLNT_APP_OAUTH_SETTINGS, oauthPluginSettings),
      EXTL_CLNT_APP_OAUTH_SETTINGS
    );
  }

  const existingOauth = firstOrSelf(
    await connection.metadata.read(EXTL_CLNT_APP_GLOBAL_OAUTH_SETTINGS, [appName])
  );
  const oauthAlreadyExists = exists(existingOauth, appName);

  const oauthSettings = {
    fullName: appName,
    externalClientApplication: appName,
    label,
    certificate,
    callbackUrl: oauthCallbackUrl,
  };

  if (oauthAlreadyExists) {
    assertSaved(
      await connection.metadata.update(EXTL_CLNT_APP_GLOBAL_OAUTH_SETTINGS, oauthSettings),
      EXTL_CLNT_APP_GLOBAL_OAUTH_SETTINGS
    );
  } else {
    assertSaved(
      await connection.metadata.create(EXTL_CLNT_APP_GLOBAL_OAUTH_SETTINGS, oauthSettings),
      EXTL_CLNT_APP_GLOBAL_OAUTH_SETTINGS
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
    await connection.metadata.read(EXTL_CLNT_APP_OAUTH_CONFIGURABLE_POLICIES, [appName])
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
      await connection.metadata.update(EXTL_CLNT_APP_OAUTH_CONFIGURABLE_POLICIES, policyMetadata),
      EXTL_CLNT_APP_OAUTH_CONFIGURABLE_POLICIES
    );
  } else {
    assertSaved(
      await connection.metadata.create(EXTL_CLNT_APP_OAUTH_CONFIGURABLE_POLICIES, policyMetadata),
      EXTL_CLNT_APP_OAUTH_CONFIGURABLE_POLICIES
    );
  }

  const resolved = firstOrSelf(
    await connection.metadata.read(EXTL_CLNT_APP_GLOBAL_OAUTH_SETTINGS, [appName])
  ) as { consumerKey?: string } | undefined;

  if (!resolved?.consumerKey) {
    throw new Error(
      `ExtlClntAppGlobalOauthSettings for '${appName}' has no consumerKey after create/update.`
    );
  }

  return { created: !appAlreadyExists, consumerKey: resolved.consumerKey };
}
