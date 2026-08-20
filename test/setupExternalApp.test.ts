import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { AuthInfo, Connection } from '@salesforce/core';
import { MockTestOrgData, shouldThrow, TestContext } from '@salesforce/core/testSetup';
import { setupExternalApp } from '../src/setupExternalApp';

const FAKE_SAVE_SUCCESS = { success: true, fullName: 'TestQA' };

function fakeCertPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'testqa-cert-'));
  const certPath = join(dir, 'server.crt');
  writeFileSync(certPath, '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n');
  return certPath;
}

describe('setupExternalApp', () => {
  const $$ = new TestContext();
  let connection: Connection;

  beforeEach(async () => {
    const testData = new MockTestOrgData();
    await $$.stubAuths(testData);
    connection = await Connection.create({
      authInfo: await AuthInfo.create({ username: testData.username }),
    });
  });

  it('creates the app, oauth config, policy, and permission set when none exist yet', async () => {
    let globalOauthReadCalls = 0;
    $$.SANDBOX.stub(connection.metadata, 'read').callsFake(async (type: string, names: string | string[]) => {
      const fullName = Array.isArray(names) ? names[0] : names;
      if (type === 'ExtlClntAppGlobalOauthSettings') {
        globalOauthReadCalls += 1;
        // First read: existence check (not found). Second read: resolve consumer key.
        return globalOauthReadCalls === 1
          ? ({ fullName: undefined } as never)
          : ({ fullName, consumerKey: 'FAKE_CONSUMER_KEY' } as never);
      }
      if (type === 'PermissionSet') {
        // Already exists — covers the update/skip-create path for this component.
        return { fullName } as never;
      }
      return { fullName: undefined } as never;
    });
    const createStub = $$.SANDBOX.stub(connection.metadata, 'create').resolves(FAKE_SAVE_SUCCESS as never);
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
    const sobjectCreateStub = $$.SANDBOX.stub().resolves({ success: true, id: '0Pa000000000001AAA' });
    $$.SANDBOX.stub(connection, 'sobject').returns({ create: sobjectCreateStub } as never);

    const result = await setupExternalApp(connection, {
      appName: 'TestQA',
      label: 'TestQA',
      description: 'Bootstrap test app.',
      contactEmail: 'demetergabor94@gmail.com',
      certPemPath: fakeCertPath(),
      preAuthUsername: 'admin@example.com',
      permissionSetName: 'TestQA_Preauthorized',
    });

    deepStrictEqual(result, { created: true, consumerKey: 'FAKE_CONSUMER_KEY' });
    strictEqual(createStub.callCount, 4); // app, oauth plugin, global oauth, policy — permission set already existed
    strictEqual(sobjectCreateStub.callCount, 1); // permission set assignment
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
        setupExternalApp(connection, {
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
      strictEqual((e as Error).message.includes('no consumerKey'), true);
    }
  });
});
