import { strictEqual } from 'node:assert';
import { AuthInfo, Connection } from '@salesforce/core';
import { MockTestOrgData, shouldThrow, TestContext } from '@salesforce/core/testSetup';
import { ensurePreAuthPermissionSet } from '../src/ensurePreAuthPermissionSet';

const FAKE_SAVE_SUCCESS = { success: true, fullName: 'My_Preauthorized' };

describe('ensurePreAuthPermissionSet', () => {
  const $$ = new TestContext();
  let connection: Connection;

  beforeEach(async () => {
    const testData = new MockTestOrgData();
    await $$.stubAuths(testData);
    connection = await Connection.create({
      authInfo: await AuthInfo.create({ username: testData.username }),
    });
  });

  it('creates the permission set and assignment when neither exists yet', async () => {
    $$.SANDBOX.stub(connection.metadata, 'read').resolves({ fullName: undefined } as never);
    const createStub = $$.SANDBOX.stub(connection.metadata, 'create').resolves(
      FAKE_SAVE_SUCCESS as never
    );
    $$.SANDBOX.stub(connection, 'query').callsFake(async (soql: string) => {
      if (soql.includes('FROM User')) {
        return { records: [{ Id: '005000000000001AAA' }], totalSize: 1, done: true } as never;
      }
      if (soql.includes('FROM PermissionSet ')) {
        return { records: [{ Id: '0PS000000000001AAA' }], totalSize: 1, done: true } as never;
      }
      return { records: [], totalSize: 0, done: true } as never;
    });
    const sobjectCreateStub = $$.SANDBOX.stub().resolves({
      success: true,
      id: '0Pa000000000001AAA',
    });
    $$.SANDBOX.stub(connection, 'sobject').returns({ create: sobjectCreateStub } as never);

    await ensurePreAuthPermissionSet(connection, {
      permissionSetName: 'My_Preauthorized',
      description: 'Pre-authorizes JWT bearer login to My app.',
      preAuthUsername: 'admin@example.com',
    });

    strictEqual(createStub.callCount, 1);
    strictEqual(sobjectCreateStub.callCount, 1);
  });

  it('skips creating the permission set when it already exists', async () => {
    $$.SANDBOX.stub(connection.metadata, 'read').resolves({
      fullName: 'My_Preauthorized',
    } as never);
    const createStub = $$.SANDBOX.stub(connection.metadata, 'create').resolves(
      FAKE_SAVE_SUCCESS as never
    );
    $$.SANDBOX.stub(connection, 'query').callsFake(async (soql: string) => {
      if (soql.includes('FROM User')) {
        return { records: [{ Id: '005000000000001AAA' }], totalSize: 1, done: true } as never;
      }
      if (soql.includes('FROM PermissionSet ')) {
        return { records: [{ Id: '0PS000000000001AAA' }], totalSize: 1, done: true } as never;
      }
      // Assignment already exists.
      return { records: [{ Id: '0Pa000000000001AAA' }], totalSize: 1, done: true } as never;
    });
    const sobjectCreateStub = $$.SANDBOX.stub();
    $$.SANDBOX.stub(connection, 'sobject').returns({ create: sobjectCreateStub } as never);

    await ensurePreAuthPermissionSet(connection, {
      permissionSetName: 'My_Preauthorized',
      description: 'Pre-authorizes JWT bearer login to My app.',
      preAuthUsername: 'admin@example.com',
    });

    strictEqual(createStub.callCount, 0);
    strictEqual(sobjectCreateStub.callCount, 0);
  });

  it('throws when no user is found with the given username', async () => {
    $$.SANDBOX.stub(connection.metadata, 'read').resolves({
      fullName: 'My_Preauthorized',
    } as never);
    $$.SANDBOX.stub(connection.metadata, 'create').resolves(FAKE_SAVE_SUCCESS as never);
    $$.SANDBOX.stub(connection, 'query').resolves({
      records: [],
      totalSize: 0,
      done: true,
    } as never);

    try {
      await shouldThrow(
        ensurePreAuthPermissionSet(connection, {
          permissionSetName: 'My_Preauthorized',
          description: 'Pre-authorizes JWT bearer login to My app.',
          preAuthUsername: 'missing@example.com',
        })
      );
    } catch (e) {
      strictEqual(
        (e as Error).message.includes("No user found with username 'missing@example.com'"),
        true
      );
    }
  });

  it('throws when the permission set is not queryable right after creation', async () => {
    $$.SANDBOX.stub(connection.metadata, 'read').resolves({ fullName: undefined } as never);
    $$.SANDBOX.stub(connection.metadata, 'create').resolves(FAKE_SAVE_SUCCESS as never);
    $$.SANDBOX.stub(connection, 'query').callsFake(async (soql: string) => {
      if (soql.includes('FROM User')) {
        return { records: [{ Id: '005000000000001AAA' }], totalSize: 1, done: true } as never;
      }
      return { records: [], totalSize: 0, done: true } as never;
    });

    try {
      await shouldThrow(
        ensurePreAuthPermissionSet(connection, {
          permissionSetName: 'My_Preauthorized',
          description: 'Pre-authorizes JWT bearer login to My app.',
          preAuthUsername: 'admin@example.com',
        })
      );
    } catch (e) {
      strictEqual((e as Error).message.includes('not queryable yet'), true);
    }
  });
});
