import { deepStrictEqual, strictEqual } from 'node:assert';
import { AuthInfo, Connection } from '@salesforce/core';
import { MockTestOrgData, shouldThrow, TestContext } from '@salesforce/core/testSetup';
import { upsertMetadata } from '../src/metadataUpsert';

const FAKE_SAVE_SUCCESS = { success: true, fullName: 'TestQA' };

describe('upsertMetadata', () => {
  const $$ = new TestContext();
  let connection: Connection;

  beforeEach(async () => {
    const testData = new MockTestOrgData();
    await $$.stubAuths(testData);
    connection = await Connection.create({
      authInfo: await AuthInfo.create({ username: testData.username }),
    });
  });

  it('creates the record when it does not exist yet', async () => {
    $$.SANDBOX.stub(connection.metadata, 'read').resolves({ fullName: undefined } as never);
    const createStub = $$.SANDBOX.stub(connection.metadata, 'create').resolves(
      FAKE_SAVE_SUCCESS as never
    );
    const updateStub = $$.SANDBOX.stub(connection.metadata, 'update').resolves(
      FAKE_SAVE_SUCCESS as never
    );

    const result = await upsertMetadata(connection, 'PermissionSet', { fullName: 'TestQA' });

    deepStrictEqual(result, { alreadyExisted: false });
    strictEqual(createStub.callCount, 1);
    strictEqual(updateStub.callCount, 0);
  });

  it('updates the record when it already exists', async () => {
    $$.SANDBOX.stub(connection.metadata, 'read').resolves({ fullName: 'TestQA' } as never);
    const createStub = $$.SANDBOX.stub(connection.metadata, 'create').resolves(
      FAKE_SAVE_SUCCESS as never
    );
    const updateStub = $$.SANDBOX.stub(connection.metadata, 'update').resolves(
      FAKE_SAVE_SUCCESS as never
    );

    const result = await upsertMetadata(connection, 'PermissionSet', { fullName: 'TestQA' });

    deepStrictEqual(result, { alreadyExisted: true });
    strictEqual(updateStub.callCount, 1);
    strictEqual(createStub.callCount, 0);
  });

  it('throws with the save error details when the API reports failure', async () => {
    $$.SANDBOX.stub(connection.metadata, 'read').resolves({ fullName: undefined } as never);
    $$.SANDBOX.stub(connection.metadata, 'create').resolves({
      success: false,
      fullName: 'TestQA',
      errors: [{ statusCode: 'DUPLICATE_VALUE', message: 'already taken' }],
    } as never);

    try {
      await shouldThrow(upsertMetadata(connection, 'PermissionSet', { fullName: 'TestQA' }));
    } catch (e) {
      strictEqual((e as Error).message.includes('DUPLICATE_VALUE'), true);
    }
  });
});
