import { Module } from '@nestjs/common';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { readFirebaseServiceAccount } from './firebase.config';

export const FIREBASE_APP = Symbol('FIREBASE_APP');

@Module({
  providers: [
    {
      provide: FIREBASE_APP,
      useFactory: (): App | null => {
        const serviceAccount = readFirebaseServiceAccount(process.env);
        if (!serviceAccount) return null;

        return (
          getApps().find((app) => app.name === 'hit-tracker') ??
          initializeApp({ credential: cert(serviceAccount) }, 'hit-tracker')
        );
      },
    },
  ],
  exports: [FIREBASE_APP],
})
export class FirebaseModule {}
