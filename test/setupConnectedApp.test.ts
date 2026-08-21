import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { AuthInfo, Connection } from '@salesforce/core';
import { MockTestOrgData, shouldThrow, TestContext } from '@salesforce/core/testSetup';
import { setupConnectedApp } from '../src/setupConnectedApp';

const FAKE_SAVE_SUCCESS = { success: true, fullName: 'TestQA' };

function fakeCertPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'testqa-cert-'));
  const certPath = join(dir, 'server.crt');
  writeFileSync(certPath, '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n');
  return certPath;
}

describe('setupConnectedApp', () => {
  const $$ = new TestContext();
  let connection: Connection;

  beforeEach(async () => {
    const testData = new MockTestOrgData();
    await $$.stubAuths(testData);
    connection = await Connection.create({
      authInfo: await AuthInfo.create({ username: testData.username }),
    });
  });

  it('creates the connected app and permission set when neither exists yet', async () => {
    let connectedAppReadCalls = 0;
    $$.SANDBOX.stub(connection.metadata, 'read').callsFake(
      async (type: string, names: string | string[]) => {
        const fullName = Array.isArray(names) ? names[0] : names;
        if (type === 'ConnectedApp') {
          connectedAppReadCalls += 1;
          // First read: existence check (not found). Second read: resolve consumer key.
          return connectedAppReadCalls === 1
            ? ({ fullName: undefined } as never)
            : ({ fullName, oauthConfig: { consumerKey: 'FAKE_CONSUMER_KEY' } } as never);
        }
        if (type === 'PermissionSet') {
          // Already exists — covers the update/skip-create path for this component.
          return { fullName } as never;
        }
        return { fullName: undefined } as never;
      }
    );
    const createStub = $$.SANDBOX.stub(connection.metadata, 'create').resolves(
      FAKE_SAVE_SUCCESS as never
    );
    $$.SANDBOX.stub(connection.metadata, 'update').resolves(FAKE_SAVE_SUCCESS as never);

    $$.SANDBOX.stub(connection, 'query').callsFake(async (soql: string) => {
      if (soql.includes('FROM User')) {
        return { records: [{ Id: '005000000000001AAA' }], totalSize: 1, done: true } as never;
      }
      if (soql.includes('FROM PermissionSet ')) {
        return { records: [{ Id: '0PS000000000001AAA' }], totalSize: 1, done: true } as never;
      }
      // PermissionSetAssignment existence check — none yet.
      return { records: [], totalSize: 0, done: true } as never;
    });
    const sobjectCreateStub = $$.SANDBOX.stub().resolves({
      success: true,
      id: '0Pa000000000001AAA',
    });
    $$.SANDBOX.stub(connection, 'sobject').returns({ create: sobjectCreateStub } as never);

    const result = await setupConnectedApp(connection, {
      appName: 'TestQA',
      label: 'TestQA',
      description: 'Bootstrap test app.',
      contactEmail: 'demetergabor94@gmail.com',
      certPemPath: fakeCertPath(),
      preAuthUsername: 'admin@example.com',
      permissionSetName: 'TestQA_Preauthorized',
    });

    deepStrictEqual(result, { created: true, consumerKey: 'FAKE_CONSUMER_KEY' });
    strictEqual(createStub.callCount, 1); // connected app only — permission set already existed
    strictEqual(sobjectCreateStub.callCount, 1); // permission set assignment
  });

  it('defaults label, description, contactEmail, oauthCallbackUrl, and permissionSetName from appName, and accepts a raw certPem', async () => {
    let connectedAppReadCalls = 0;
    const createCalls: Array<{ type: string; metadata: Record<string, unknown> }> = [];

    $$.SANDBOX.stub(connection.metadata, 'read').callsFake(
      async (type: string, names: string | string[]) => {
        const fullName = Array.isArray(names) ? names[0] : names;
        if (type === 'ConnectedApp') {
          connectedAppReadCalls += 1;
          return connectedAppReadCalls === 1
            ? ({ fullName: undefined } as never)
            : ({ fullName, oauthConfig: { consumerKey: 'FAKE_CONSUMER_KEY' } } as never);
        }
        return { fullName: undefined } as never;
      }
    );
    $$.SANDBOX.stub(connection.metadata, 'create').callsFake(
      async (type: string, metadata: Record<string, unknown>) => {
        createCalls.push({ type, metadata });
        return FAKE_SAVE_SUCCESS as never;
      }
    );
    $$.SANDBOX.stub(connection.metadata, 'update').resolves(FAKE_SAVE_SUCCESS as never);
    $$.SANDBOX.stub(connection, 'query').callsFake(async (soql: string) => {
      if (soql.includes('FROM User')) {
        return { records: [{ Id: '005000000000001AAA' }], totalSize: 1, done: true } as never;
      }
      if (soql.includes('FROM PermissionSet ')) {
        return { records: [{ Id: '0PS000000000001AAA' }], totalSize: 1, done: true } as never;
      }
      return { records: [], totalSize: 0, done: true } as never;
    });
    $$.SANDBOX.stub(connection, 'sobject').returns({
      create: $$.SANDBOX.stub().resolves({ success: true, id: '0Pa000000000001AAA' }),
    } as never);

    await setupConnectedApp(connection, {
      appName: 'DefaultsApp',
      preAuthUsername: 'admin@example.com',
      certPem: '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n',
    });

    const appCreate = createCalls.find((c) => c.type === 'ConnectedApp');
    strictEqual(appCreate?.metadata.label, 'DefaultsApp');
    strictEqual(appCreate?.metadata.contactEmail, 'gabor.demeter@gforceinnovation.com');
    deepStrictEqual(appCreate?.metadata.permissionSetName, ['DefaultsApp_Preauthorized']);

    const oauthConfig = appCreate?.metadata.oauthConfig as Record<string, unknown> | undefined;
    strictEqual(oauthConfig?.callbackUrl, 'https://login.salesforce.com/services/oauth2/success');
    strictEqual(
      oauthConfig?.certificate,
      '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n'
    );
    strictEqual(oauthConfig?.isAdminApproved, true);
    deepStrictEqual(oauthConfig?.scopes, ['Api', 'RefreshToken']);
  });

  it('uses a custom oauth scope list when provided', async () => {
    const createCalls: Array<{ type: string; metadata: Record<string, unknown> }> = [];
    let connectedAppReadCalls = 0;

    $$.SANDBOX.stub(connection.metadata, 'read').callsFake(
      async (type: string, names: string | string[]) => {
        const fullName = Array.isArray(names) ? names[0] : names;
        if (type === 'ConnectedApp') {
          connectedAppReadCalls += 1;
          return connectedAppReadCalls === 1
            ? ({ fullName: undefined } as never)
            : ({ fullName, oauthConfig: { consumerKey: 'FAKE_CONSUMER_KEY' } } as never);
        }
        return { fullName: undefined } as never;
      }
    );
    $$.SANDBOX.stub(connection.metadata, 'create').callsFake(
      async (type: string, metadata: Record<string, unknown>) => {
        createCalls.push({ type, metadata });
        return FAKE_SAVE_SUCCESS as never;
      }
    );
    $$.SANDBOX.stub(connection.metadata, 'update').resolves(FAKE_SAVE_SUCCESS as never);
    $$.SANDBOX.stub(connection, 'query').callsFake(async (soql: string) => {
      if (soql.includes('FROM User')) {
        return { records: [{ Id: '005000000000001AAA' }], totalSize: 1, done: true } as never;
      }
      if (soql.includes('FROM PermissionSet ')) {
        return { records: [{ Id: '0PS000000000001AAA' }], totalSize: 1, done: true } as never;
      }
      return { records: [], totalSize: 0, done: true } as never;
    });
    $$.SANDBOX.stub(connection, 'sobject').returns({
      create: $$.SANDBOX.stub().resolves({ success: true, id: '0Pa000000000001AAA' }),
    } as never);

    await setupConnectedApp(connection, {
      appName: 'WebScopeApp',
      preAuthUsername: 'admin@example.com',
      certPem: '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n',
      oauthScopes: ['Api', 'RefreshToken', 'Web'],
    });

    const appCreate = createCalls.find((c) => c.type === 'ConnectedApp');
    const oauthConfig = appCreate?.metadata.oauthConfig as Record<string, unknown> | undefined;
    deepStrictEqual(oauthConfig?.scopes, ['Api', 'RefreshToken', 'Web']);
  });

  it('throws when the consumer key never resolves', async () => {
    $$.SANDBOX.stub(connection.metadata, 'read').resolves({ fullName: undefined } as never);
    $$.SANDBOX.stub(connection.metadata, 'create').resolves(FAKE_SAVE_SUCCESS as never);
    $$.SANDBOX.stub(connection.metadata, 'update').resolves(FAKE_SAVE_SUCCESS as never);
    $$.SANDBOX.stub(connection, 'query').resolves({
      records: [{ Id: '005000000000001AAA' }],
      totalSize: 1,
      done: true,
    } as never);
    $$.SANDBOX.stub(connection, 'sobject').returns({
      create: $$.SANDBOX.stub().resolves({ success: true, id: '0Pa000000000001AAA' }),
    } as never);

    try {
      await shouldThrow(
        setupConnectedApp(connection, {
          appName: 'TestQA',
          label: 'TestQA',
          description: 'Bootstrap test app.',
          contactEmail: 'demetergabor94@gmail.com',
          certPemPath: fakeCertPath(),
          preAuthUsername: 'admin@example.com',
          permissionSetName: 'TestQA_Preauthorized',
        })
      );
    } catch (e) {
      strictEqual((e as Error).message.includes('no oauthConfig.consumerKey'), true);
    }
  });
});
