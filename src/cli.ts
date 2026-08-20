import { getConnection } from './getConnection';
import { setupExternalApp } from './setupExternalApp';
import { arg, optionalArg } from './cliArgs';

async function main() {
  const org = arg('org');
  const appName = arg('app-name', 'TestQA');
  const preAuthUsername = arg('preauth-username');
  const permissionSetName = optionalArg('permission-set');
  const contactEmail = optionalArg('contact-email');
  // CI-friendly: a secret manager can inject the PEM directly, skipping the filesystem.
  const certPem = process.env.SF_JWT_CERT_PEM;
  const certPath = arg(
    'cert-file',
    `${process.env.HOME}/.sf-jwt/${appName.toLowerCase()}/server.crt`
  );

  const connection = await getConnection(org);
  const result = certPem
    ? await setupExternalApp(connection, {
        appName,
        preAuthUsername,
        ...(permissionSetName ? { permissionSetName } : {}),
        ...(contactEmail ? { contactEmail } : {}),
        certPem,
      })
    : await setupExternalApp(connection, {
        appName,
        preAuthUsername,
        ...(permissionSetName ? { permissionSetName } : {}),
        ...(contactEmail ? { contactEmail } : {}),
        certPemPath: certPath,
      });

  console.log(`${result.created ? 'Created' : 'Updated'} '${appName}' in ${org}`);
  console.log(`consumerKey=${result.consumerKey}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
