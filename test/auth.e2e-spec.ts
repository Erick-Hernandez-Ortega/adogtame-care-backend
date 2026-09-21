import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { accounts } from '../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../src/infrastructure/database/database.service';

interface AuthenticationResponse {
  accessToken: string;
}

function uniqueEmail(label: string): string {
  return `${label}-${randomUUID()}@example.com`;
}

describe('POST /auth/login (e2e)', () => {
  let application: INestApplication<App>;
  let databaseService: DatabaseService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    application = moduleFixture.createNestApplication();
    await application.init();
    databaseService = application.get(DatabaseService);
  });

  afterAll(async () => {
    await application.close();
  });

  it('authenticates an account and returns only a verifiable access token', async () => {
    const email: string = uniqueEmail('authentication');
    const password: string = 'a secure password';

    try {
      const registrationResponse = await request(application.getHttpServer())
        .post('/accounts')
        .send({ email, password })
        .expect(201);
      const accountId: string = (registrationResponse.body as { id: string })
        .id;

      const response = await request(application.getHttpServer())
        .post('/auth/login')
        .send({ email: ` ${email.toUpperCase()} `, password })
        .expect(200);
      const body: AuthenticationResponse =
        response.body as AuthenticationResponse;
      const secret: string | undefined = process.env.JWT_ACCESS_TOKEN_SECRET;

      if (secret === undefined) {
        throw new Error('JWT access token secret is not configured for tests');
      }

      const { payload, protectedHeader } = await jwtVerify(
        body.accessToken,
        new TextEncoder().encode(secret),
        { algorithms: ['HS256'] },
      );

      expect(response.body).toEqual({
        accessToken: expect.any(String) as string,
      });
      expect(response.body).not.toHaveProperty('email');
      expect(response.body).not.toHaveProperty('password');
      expect(response.body).not.toHaveProperty('passwordHash');
      expect(protectedHeader.alg).toBe('HS256');
      expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);
      expect(payload.sub).toBe(accountId);
      expect(payload.exp).toBe((payload.iat as number) + 3600);
    } finally {
      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.email, email));
    }
  });

  it('returns 400 for an invalid request shape', async () => {
    const response = await request(application.getHttpServer())
      .post('/auth/login')
      .send({ email: 'erick@example.com', password: 'password', extra: true })
      .expect(400);

    expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('returns 422 for a semantically invalid email', async () => {
    const response = await request(application.getHttpServer())
      .post('/auth/login')
      .send({ email: 'invalid-email', password: 'password' })
      .expect(422);

    expect(response.body).toMatchObject({ code: 'INVALID_EMAIL' });
  });

  it('returns the exact invalid credentials response for a missing account', async () => {
    const response = await request(application.getHttpServer())
      .post('/auth/login')
      .send({ email: uniqueEmail('missing'), password: 'password' })
      .expect(401);

    expect(response.body).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect',
    });
  });

  it('returns the same invalid credentials response for a wrong password', async () => {
    const email: string = uniqueEmail('wrong-password');

    try {
      await request(application.getHttpServer())
        .post('/accounts')
        .send({ email, password: 'correct password' })
        .expect(201);

      const response = await request(application.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'wrong password' })
        .expect(401);

      expect(response.body).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    } finally {
      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.email, email));
    }
  });
});
