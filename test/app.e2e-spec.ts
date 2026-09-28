import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/config/configure-app';

describe('application (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  });

  it('rejects unauthenticated requests with a request ID', () => {
    return request(app.getHttpServer())
      .get('/workout-programs')
      .set('X-Request-Id', 'integration_123')
      .expect(401)
      .expect('X-Request-Id', 'integration_123')
      .expect(({ body }) => {
        expect(body.requestId).toBe('integration_123');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
