import type { Connection } from '@salesforce/core';
import { type CertificateInput, resolveCertificatePem } from './certificateInput';
import { ensurePreAuthPermissionSet } from './ensurePreAuthPermissionSet';
import { firstOrSelf, upsertMetadata } from './metadataUpsert';

export type SetupConnectedAppOptions = {
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
  /** Defaults to `['Api', 'RefreshToken']`. Add `'Web'` when the integration needs a web session, not just API access. */
  oauthScopes?: string[];
} & CertificateInput;

export interface SetupConnectedAppResult {
  created: boolean;
  consumerKey: string;
}

const DEFAULT_CONTACT_EMAIL = 'gabor.demeter@gforceinnovation.com';
const DEFAULT_OAUTH_CALLBACK_URL = 'https://login.salesforce.com/services/oauth2/success';
const DEFAULT_OAUTH_SCOPES = ['Api', 'RefreshToken'];

/**
 * Idempotently creates or updates a classic Connected App named `appName`,
 * configured for the JWT bearer flow (certificate + admin-approved
 * pre-authorization via a permission set) and returns the resolved consumer
 * key.
 *
 * Unlike `setupExternalApp`, this targets `ConnectedApp` — the older
 * metadata type — because Dev Hub scratch-org creation (`sf org create
 * scratch`) only recognizes a classic Connected App as the OAuth client,
 * not an External Client App. Everything a Connected App needs (cert,
 * scopes, admin-approval, pre-authorized permission set) lives on one
 * metadata object, so there's no multi-component chain like the ECA has.
 */
export async function setupConnectedApp(
  connection: Connection,
  options: SetupConnectedAppOptions
): Promise<SetupConnectedAppResult> {
  const { appName, preAuthUsername } = options;
  const label = options.label ?? appName;
  const description =
    options.description ?? `Bootstrap connected app '${appName}' via @salesforce/core.`;
  const contactEmail = options.contactEmail ?? DEFAULT_CONTACT_EMAIL;
  const oauthCallbackUrl = options.oauthCallbackUrl ?? DEFAULT_OAUTH_CALLBACK_URL;
  const permissionSetName = options.permissionSetName ?? `${appName}_Preauthorized`;
  const oauthScopes = options.oauthScopes ?? DEFAULT_OAUTH_SCOPES;
  const certificate = resolveCertificatePem(options);

  // The permission set must exist before the Connected App is saved: the
  // app's own `permissionSetName` field references it by name in the same
  // create/update call, unlike the ECA where the equivalent reference lives
  // on a separate, later metadata object.
  await ensurePreAuthPermissionSet(connection, {
    permissionSetName,
    description: `Pre-authorizes JWT bearer login to the ${appName} connected app.`,
    preAuthUsername,
  });

  const connectedAppMetadata = {
    fullName: appName,
    label,
    description,
    contactEmail,
    oauthConfig: {
      callbackUrl: oauthCallbackUrl,
      certificate,
      isAdminApproved: true,
      scopes: oauthScopes,
    },
    permissionSetName: [permissionSetName],
  };
  const { alreadyExisted } = await upsertMetadata(connection, 'ConnectedApp', connectedAppMetadata);

  const resolved = firstOrSelf(await connection.metadata.read('ConnectedApp', [appName])) as
    { oauthConfig?: { consumerKey?: string } } | undefined;

  const consumerKey = resolved?.oauthConfig?.consumerKey;
  if (!consumerKey) {
    throw new Error(
      `ConnectedApp '${appName}' has no oauthConfig.consumerKey after create/update.`
    );
  }

  return { created: !alreadyExisted, consumerKey };
}
