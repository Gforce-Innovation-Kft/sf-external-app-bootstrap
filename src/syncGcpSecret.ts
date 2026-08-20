import { readFileSync } from 'node:fs';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { arg } from './cliArgs';

/**
 * The JSON shape stored in each `salesforce-<env>` GCP Secret Manager secret —
 * see gforce-google-infra's design doc §4.2. `jwt_key` is the raw PEM private
 * key content, not base64-encoded.
 */
export interface GcpSecretJwtBundle {
  username: string;
  client_id: string;
  instance_url: string;
  jwt_key: string;
}

export interface SyncGcpSecretOptions {
  projectId: string;
  secretName: string;
  bundle: GcpSecretJwtBundle;
}

export interface SyncGcpSecretResult {
  secretName: string;
  versionName: string;
}

type SecretManagerClient = Pick<SecretManagerServiceClient, 'secretPath' | 'addSecretVersion'>;

/**
 * Adds a new version to an existing `salesforce-<env>` secret — always an
 * upsert in the sense that Secret Manager versions are append-only and
 * `accessSecretVersion(..., "latest")` picks up whatever was added last.
 * Never creates the secret container itself: the 3 known envs (devhub,
 * integration, demo-prod) already have containers provisioned by
 * gforce-google-infra's Terraform, and the identity this runs as
 * (the `gcp-secrets-admin` WIF claim) only has secretVersionAdder, not
 * secret-creation permission — a missing container fails loudly here
 * rather than silently trying (and failing) to create one.
 */
export async function syncGcpSecret(
  options: SyncGcpSecretOptions,
  client: SecretManagerClient = new SecretManagerServiceClient()
): Promise<SyncGcpSecretResult> {
  const secretName = client.secretPath(options.projectId, options.secretName);
  const payload = Buffer.from(JSON.stringify(options.bundle), 'utf8');

  const [version] = await client.addSecretVersion({
    parent: secretName,
    payload: { data: payload },
  });

  if (!version.name) {
    throw new Error(`addSecretVersion for '${secretName}' returned no version name.`);
  }

  return { secretName, versionName: version.name };
}

function main(): void {
  const projectId = arg('gcp-project-id');
  const secretName = arg('gcp-secret-name');
  const username = arg('username');
  const clientId = arg('client-id');
  const instanceUrl = arg('instance-url', 'https://login.salesforce.com');
  const keyFile = arg('key-file');

  const jwtKey = readFileSync(keyFile, 'utf8');

  syncGcpSecret({
    projectId,
    secretName,
    bundle: { username, client_id: clientId, instance_url: instanceUrl, jwt_key: jwtKey },
  })
    .then((result) => {
      console.log(`Added new version to '${result.secretName}': ${result.versionName}`);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

if (require.main === module) {
  main();
}
