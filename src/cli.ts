import { getConnection } from './getConnection';
import { setupExternalApp } from './setupExternalApp';

function arg(name: string, fallback?: string): string {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required argument: ${flag}`);
}

async function main() {
  const org = arg('org');
  const appName = arg('app-name', 'TestQA');
  const certPath = arg('cert-file', `${process.env.HOME}/.sf-jwt/testqa/server.crt`);

  const connection = await getConnection(org);
  const result = await setupExternalApp(connection, {
    appName,
    label: appName,
    description: 'Bootstrap test app for JWT-based External Client App automation.',
    contactEmail: arg('contact-email', 'demetergabor94@gmail.com'),
    certPemPath: certPath,
    preAuthUsername: arg('preauth-username'),
    permissionSetName: arg('permission-set', `${appName}_Preauthorized`),
  });

  console.log(`${result.created ? 'Created' : 'Updated'} '${appName}' in ${org}`);
  console.log(`consumerKey=${result.consumerKey}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
