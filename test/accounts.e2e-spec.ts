import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { verify } from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { accounts } from '../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../src/infrastructure/database/database.service';

interface AccountResponse {
  id: string;
  email: string;
}

function uniqueEmail(label: string): string {
  return `${label}-${randomUUID()}@example.com`;
}

describe('POST /accounts (e2e)', () => {
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

  it('registers an account without exposing or persisting plaintext', async () => {
    const email: string = uniqueEmail('registration');
    const plaintextPassword: string = 'a secure password';

    try {
      const response = await request(application.getHttpServer())
        .post('/accounts')
        .send({
          email: ` ${email.toUpperCase()} `,
          password: plaintextPassword,
        })
        .expect(201);
      const body: AccountResponse = response.body as AccountResponse;

      expect(body).toEqual({ id: expect.any(String) as string, email });
      expect(response.body).not.toHaveProperty('password');
      expect(response.body).not.toHaveProperty('passwordHash');

      const savedAccounts = await databaseService.connection
        .select()
        .from(accounts)
        .where(eq(accounts.id, body.id));
      expect(savedAccounts).toHaveLength(1);
      expect(savedAccounts[0].passwordHash).not.toBe(plaintextPassword);
      await expect(
        verify(savedAccounts[0].passwordHash, plaintextPassword),
      ).resolves.toBe(true);
    } finally {
      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.email, email));
    }
  });

  it('returns 400 for an invalid request shape', async () => {
    const response = await request(application.getHttpServer())
      .post('/accounts')
      .send({ email: 'erick@example.com', unexpected: true })
      .expect(400);

    expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('returns 422 for an invalid email', async () => {
    const response = await request(application.getHttpServer())
      .post('/accounts')
      .send({ email: 'invalid-email', password: 'a secure password' })
      .expect(422);

    expect(response.body).toMatchObject({ code: 'INVALID_EMAIL' });
  });

  it.each(['short', 'a'.repeat(129)])(
    'returns 422 for a password outside the policy',
    async (password: string) => {
      const response = await request(application.getHttpServer())
        .post('/accounts')
        .send({ email: uniqueEmail('invalid-password'), password })
        .expect(422);

      expect(response.body).toMatchObject({ code: 'INVALID_PASSWORD' });
    },
  );

  it('returns 409 for an equivalent registered email', async () => {
    const email: string = uniqueEmail('duplicate');

    try {
      await request(application.getHttpServer())
        .post('/accounts')
        .send({ email: ` ${email.toUpperCase()} `, password: 'first password' })
        .expect(201);
      const response = await request(application.getHttpServer())
        .post('/accounts')
        .send({ email, password: 'second password' })
        .expect(409);

      expect(response.body).toMatchObject({
        code: 'EMAIL_ALREADY_REGISTERED',
      });
      const savedAccounts = await databaseService.connection
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.email, email));
      expect(savedAccounts).toHaveLength(1);
    } finally {
      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.email, email));
    }
  });
});
