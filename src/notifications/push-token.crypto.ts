import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { readFirebaseServiceAccount } from '../firebase/firebase.config';

const VERSION = 'v1';

function keyFrom(material: string) {
  return createHash('sha256')
    .update('hit-tracker-push-token-v1\0')
    .update(material)
    .digest();
}

export function hashPushToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function encryptPushToken(token: string, keyMaterial: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyMaterial), nonce);
  const encrypted = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ]);
  return [
    VERSION,
    nonce.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptPushToken(ciphertext: string, keyMaterial: string) {
  const [version, nonce, tag, encrypted] = ciphertext.split('.');
  if (version !== VERSION || !nonce || !tag || !encrypted) {
    throw new Error('Unsupported push token ciphertext');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFrom(keyMaterial),
    Buffer.from(nonce, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

@Injectable()
export class PushTokenCrypto {
  private keyMaterial() {
    const serviceAccount = readFirebaseServiceAccount(process.env);
    if (!serviceAccount?.privateKey) {
      throw new ServiceUnavailableException({
        code: 'PUSH_NOTIFICATIONS_UNAVAILABLE',
      });
    }
    return serviceAccount.privateKey;
  }

  encrypt(token: string) {
    return encryptPushToken(token, this.keyMaterial());
  }

  decrypt(ciphertext: string) {
    return decryptPushToken(ciphertext, this.keyMaterial());
  }
}
