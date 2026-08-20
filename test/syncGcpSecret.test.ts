import { deepStrictEqual, strictEqual } from 'node:assert';
import sinon from 'sinon';
import { syncGcpSecret } from '../src/syncGcpSecret';

describe('syncGcpSecret', () => {
  it('adds a new version to the resolved secret path and returns its name', async () => {
    const secretPath = sinon
      .stub()
      .returns('projects/gforce-salesforce-cicd/secrets/salesforce-devhub');
    const addSecretVersion = sinon
      .stub()
      .resolves([{ name: 'projects/.../secrets/salesforce-devhub/versions/7' }]);

    const result = await syncGcpSecret(
      {
        projectId: 'gforce-salesforce-cicd',
        secretName: 'salesforce-devhub',
        bundle: {
          username: 'admin@example.com',
          client_id: 'FAKE_CONSUMER_KEY',
          instance_url: 'https://login.salesforce.com',
          jwt_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
        },
      },
      { secretPath, addSecretVersion } as never
    );

    strictEqual(secretPath.calledOnceWith('gforce-salesforce-cicd', 'salesforce-devhub'), true);
    deepStrictEqual(
      addSecretVersion.firstCall.args[0].parent,
      'projects/gforce-salesforce-cicd/secrets/salesforce-devhub'
    );
    const payload = JSON.parse(
      (addSecretVersion.firstCall.args[0].payload.data as Buffer).toString('utf8')
    );
    deepStrictEqual(payload, {
      username: 'admin@example.com',
      client_id: 'FAKE_CONSUMER_KEY',
      instance_url: 'https://login.salesforce.com',
      jwt_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
    });
    deepStrictEqual(result, {
      secretName: 'projects/gforce-salesforce-cicd/secrets/salesforce-devhub',
      versionName: 'projects/.../secrets/salesforce-devhub/versions/7',
    });
  });

  it('throws when addSecretVersion returns no version name', async () => {
    const secretPath = sinon
      .stub()
      .returns('projects/gforce-salesforce-cicd/secrets/salesforce-devhub');
    const addSecretVersion = sinon.stub().resolves([{}]);

    await syncGcpSecret(
      {
        projectId: 'gforce-salesforce-cicd',
        secretName: 'salesforce-devhub',
        bundle: {
          username: 'admin@example.com',
          client_id: 'FAKE_CONSUMER_KEY',
          instance_url: 'https://login.salesforce.com',
          jwt_key: 'fake',
        },
      },
      { secretPath, addSecretVersion } as never
    ).then(
      () => {
        throw new Error('expected syncGcpSecret to reject');
      },
      (err: unknown) => {
        strictEqual(err instanceof Error && err.message.includes('no version name'), true);
      }
    );
  });
});
