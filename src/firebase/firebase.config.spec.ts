import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFirebaseServiceAccount } from './firebase.config';

describe('readFirebaseServiceAccount', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hit-firebase-'));
  const credentialPath = join(directory, 'service-account.json');

  afterAll(() => rmSync(directory, { force: true, recursive: true }));

  it('loads a configured service-account file without exposing its key', () => {
    writeFileSync(
      credentialPath,
      JSON.stringify({
        project_id: 'hit-tracker-auraxa',
        client_email: 'firebase-adminsdk@example.iam.gserviceaccount.com',
        private_key: 'not-a-real-key',
      }),
    );

    expect(
      readFirebaseServiceAccount({
        FIREBASE_SERVICE_ACCOUNT_PATH: credentialPath,
      }),
    ).toMatchObject({ projectId: 'hit-tracker-auraxa' });
  });
});
