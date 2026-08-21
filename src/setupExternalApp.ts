import type { Connection } from '@salesforce/core';
import { type CertificateInput, resolveCertificatePem } from './certificateInput';
import { ensurePreAuthPermissionSet } from './ensurePreAuthPermissionSet';
import { firstOrSelf, type MetadataApiType, upsertMetadata } from './metadataUpsert';

/**
 * @salesforce/core's exported `MetadataType` union predates these External
 * Client App metadata types — the Metadata API accepts them at runtime, so a
 * narrow cast (derived from the real method signature, not `any`) is needed.
 */
const EXTERNAL_CLIENT_APPLICATION = 'ExternalClientApplication' as unknown as MetadataApiType;
const EXTL_CLNT_APP_OAUTH_SETTINGS = 'ExtlClntAppOauthSettings' as unknown as MetadataApiType;
const EXTL_CLNT_APP_GLOBAL_OAUTH_SETTINGS =
  'ExtlClntAppGlobalOauthSettings' as unknown as MetadataApiType;
const EXTL_CLNT_APP_OAUTH_CONFIGURABLE_POLICIES =
  'ExtlClntAppOauthConfigurablePolicies' as unknown as MetadataApiType;

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
  const description =
    options.description ?? `Bootstrap external client app '${appName}' via @salesforce/core.`;
  const contactEmail = options.contactEmail ?? DEFAULT_CONTACT_EMAIL;
  const oauthCallbackUrl = options.oauthCallbackUrl ?? DEFAULT_OAUTH_CALLBACK_URL;
  const permissionSetName = options.permissionSetName ?? `${appName}_Preauthorized`;
  const certificate = resolveCertificatePem(options);

  const appMetadata = {
    fullName: appName,
    label,
    description,
    contactEmail,
    distributionState: 'Local',
    isProtected: false,
  };
  const { alreadyExisted: appAlreadyExists } = await upsertMetadata(
    connection,
    EXTERNAL_CLIENT_APPLICATION,
    appMetadata
  );

  const oauthPluginSettings = {
    fullName: appName,
    externalClientApplication: appName,
    label,
    commaSeparatedOauthScopes: 'Api,RefreshToken',
  };
  await upsertMetadata(connection, EXTL_CLNT_APP_OAUTH_SETTINGS, oauthPluginSettings);

  const oauthSettings = {
    fullName: appName,
    externalClientApplication: appName,
    label,
    certificate,
    callbackUrl: oauthCallbackUrl,
  };
  await upsertMetadata(connection, EXTL_CLNT_APP_GLOBAL_OAUTH_SETTINGS, oauthSettings);

  await ensurePreAuthPermissionSet(connection, {
    permissionSetName,
    description: `Pre-authorizes JWT bearer login to the ${appName} external client app.`,
    preAuthUsername,
  });

  const policyMetadata = {
    fullName: appName,
    externalClientApplication: appName,
    label,
    permittedUsersPolicyType: 'AdminApprovedPreAuthorized',
    commaSeparatedPermissionSet: permissionSetName,
  };
  await upsertMetadata(connection, EXTL_CLNT_APP_OAUTH_CONFIGURABLE_POLICIES, policyMetadata);

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
