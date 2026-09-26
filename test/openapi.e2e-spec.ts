import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type {
  OpenAPIObject,
  OperationObject,
  ResponseObject,
  SchemaObject,
} from '@nestjs/swagger';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureOpenApi } from '../src/infrastructure/http/configure-openapi';

function responseSchema(
  operation: OperationObject | undefined,
  status: string,
): SchemaObject | undefined {
  const response: ResponseObject | undefined = operation?.responses[status] as
    ResponseObject | undefined;
  return response?.content?.['application/json']?.schema as
    SchemaObject | undefined;
}

describe('OpenAPI documentation (e2e)', () => {
  let application: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    application = moduleFixture.createNestApplication();
    configureOpenApi(application);
    await application.init();
  });

  afterAll(async () => {
    await application.close();
  });

  it('serves Swagger UI and documents all seven routes and their contracts', async () => {
    const htmlResponse = await request(application.getHttpServer())
      .get('/docs')
      .expect(200);
    expect(htmlResponse.text).toContain('swagger-ui');

    const jsonResponse = await request(application.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const document: OpenAPIObject = jsonResponse.body as OpenAPIObject;

    const routes: [string, string][] = [
      ['/', 'get'],
      ['/accounts', 'post'],
      ['/auth/login', 'post'],
      ['/pets', 'get'],
      ['/pets/{petId}', 'get'],
      ['/pets', 'post'],
      ['/pets/{petId}/invitations', 'post'],
    ];
    for (const [path, method] of routes) {
      const operation: OperationObject | undefined =
        document.paths[path]?.[method as 'get' | 'post'];
      expect(operation).toBeDefined();
      expect(operation?.summary).toBeTruthy();
    }
    expect(
      Object.values(document.paths).reduce(
        (count: number, path) =>
          count + Number(Boolean(path?.get)) + Number(Boolean(path?.post)),
        0,
      ),
    ).toBe(7);

    expect(document.components?.securitySchemes?.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });

    for (const [path, method] of routes) {
      const operation: OperationObject | undefined =
        document.paths[path]?.[method as 'get' | 'post'];
      expect(operation?.security ?? []).toEqual(
        path.startsWith('/pets') ? [{ bearer: [] }] : [],
      );
    }

    const account = document.paths['/accounts']?.post;
    const login = document.paths['/auth/login']?.post;
    const list = document.paths['/pets']?.get;
    const detail = document.paths['/pets/{petId}']?.get;
    const create = document.paths['/pets']?.post;
    const invite = document.paths['/pets/{petId}/invitations']?.post;

    for (const operation of [account, login, create, invite]) {
      const requestSchema =
        operation?.requestBody && 'content' in operation.requestBody
          ? (operation.requestBody.content['application/json']
              ?.schema as SchemaObject)
          : undefined;
      expect(requestSchema?.type).toBe('object');
      expect(requestSchema?.required).toBeDefined();
      expect(operation?.responses['400']).toBeDefined();
    }

    expect(account?.responses['201']).toBeDefined();
    expect(account?.responses['409']).toBeDefined();
    expect(account?.responses['422']).toBeDefined();
    expect(login?.responses['200']).toBeDefined();
    expect(login?.responses['401']).toBeDefined();
    expect(list?.responses['200']).toBeDefined();
    expect(detail?.responses['404']).toBeDefined();
    expect(create?.responses['201']).toBeDefined();
    expect(create?.responses['422']).toBeDefined();
    expect(invite?.responses['201']).toBeDefined();
    expect(invite?.responses['404']).toBeDefined();
    expect(invite?.responses['409']).toBeDefined();
    expect(invite?.responses['422']).toBeDefined();

    for (const operation of [list, detail, create, invite]) {
      expect(operation?.responses['401']).toBeDefined();
    }

    for (const operation of [detail, invite]) {
      expect(operation?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'petId',
            in: 'path',
            required: true,
            schema: expect.objectContaining({ format: 'uuid' }) as object,
          }) as object,
        ]),
      );
    }

    const petRequestSchema =
      create?.requestBody && 'content' in create.requestBody
        ? (create.requestBody.content['application/json']
            ?.schema as SchemaObject)
        : undefined;
    expect(petRequestSchema?.required).toEqual(
      expect.arrayContaining([
        'name',
        'species',
        'breed',
        'sex',
        'birthInformation',
      ]),
    );
    expect(petRequestSchema?.properties?.species).toMatchObject({
      enum: ['DOG', 'CAT'],
    });
    expect(petRequestSchema?.properties?.color).toBeDefined();
    expect(petRequestSchema?.required).not.toContain('color');
    expect(petRequestSchema?.additionalProperties).toBe(false);

    expect(responseSchema(account, '201')?.required).toEqual(['id', 'email']);
    expect(responseSchema(login, '200')?.required).toEqual(['accessToken']);
    expect(responseSchema(list, '200')).toMatchObject({ type: 'array' });
    expect(responseSchema(detail, '200')?.required).toContain('role');
    expect(responseSchema(create, '201')?.required).toContain('memberships');
    expect(responseSchema(invite, '201')?.required).toEqual(
      expect.arrayContaining([
        'id',
        'petId',
        'email',
        'status',
        'createdAt',
        'expiresAt',
      ]),
    );
    expect(responseSchema(invite, '201')?.properties?.status).toMatchObject({
      enum: ['PENDING'],
    });

    const errorCases: [OperationObject | undefined, string, string[]][] = [
      [account, '400', ['INVALID_REQUEST']],
      [account, '409', ['EMAIL_ALREADY_REGISTERED']],
      [account, '422', ['INVALID_EMAIL', 'INVALID_PASSWORD']],
      [login, '401', ['INVALID_CREDENTIALS']],
      [detail, '404', ['PET_NOT_FOUND']],
      [create, '422', ['INVALID_PET']],
      [invite, '409', ['ALREADY_PET_MEMBER', 'INVITATION_ALREADY_PENDING']],
    ];
    for (const [operation, status, codes] of errorCases) {
      expect(responseSchema(operation, status)?.required).toEqual([
        'code',
        'message',
      ]);
      expect(responseSchema(operation, status)?.properties?.code).toMatchObject(
        { enum: codes },
      );
    }
  });
});
