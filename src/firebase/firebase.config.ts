import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ServiceAccount } from 'firebase-admin/app';

interface FirebaseServiceAccountJson {
  project_id?: string;
  client_email?: string;
  private_key?: string;
}

function isServiceAccountJson(
  value: unknown,
): value is FirebaseServiceAccountJson {
  return typeof value === 'object' && value !== null;
}

export function readFirebaseServiceAccount(
  environment: NodeJS.ProcessEnv,
): ServiceAccount | null {
  const configuredPath = environment.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  if (!configuredPath) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolve(configuredPath), 'utf8'));
  } catch {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_PATH must point to readable JSON.',
    );
  }

  if (
    !isServiceAccountJson(parsed) ||
    !parsed.project_id ||
    !parsed.client_email ||
    !parsed.private_key
  ) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_PATH must point to a Firebase service-account JSON file.',
    );
  }

  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}

export function validateFirebaseEnvironment(
  environment: NodeJS.ProcessEnv,
): void {
  readFirebaseServiceAccount(environment);
}
