import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { configureTrustProxy } from './trust-proxy';

describe('HTTPS proxy session cookies', () => {
  it('sets a secure cookie when the production proxy reports HTTPS', async () => {
    const app = express();
    configureTrustProxy(app, true);
    app.use(
      session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: true,
        cookie: { secure: true },
      }),
    );
    app.get('/', (_request, response) => response.sendStatus(204));

    const response = await request(app)
      .get('/')
      .set('X-Forwarded-Proto', 'https');

    expect(response.headers['set-cookie']?.[0]).toContain('Secure');
  });
});
