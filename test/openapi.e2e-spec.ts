import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { OpenAPIObject, OperationObject, ResponseObject, SchemaObject } from '@nestjs/swagger';
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

    return response?.content?.['application/json']?.schema as SchemaObject | undefined;
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

    it('serves Swagger UI and documents all thirty-two operations and their contracts', async () => {
        const htmlResponse = await request(application.getHttpServer()).get('/docs').expect(200);

        expect(htmlResponse.text).toContain('swagger-ui');

        const jsonResponse = await request(application.getHttpServer())
            .get('/docs-json')
            .expect(200);
        const document: OpenAPIObject = jsonResponse.body as OpenAPIObject;

        expect(JSON.stringify(document)).not.toContain('OWNER_REMOVAL_NOT_SUPPORTED');

        const routes: [string, string][] = [
            ['/', 'get'],
            ['/accounts', 'post'],
            ['/auth/login', 'post'],
            ['/pets', 'get'],
            ['/pets/{petId}', 'get'],
            ['/pets/{petId}/members', 'get'],
            ['/pets/{petId}/members/{membershipId}', 'delete'],
            ['/pets/{petId}/members/{membershipId}/promote', 'post'],
            ['/pets/{petId}', 'patch'],
            ['/pets', 'post'],
            ['/pets/{petId}/invitations', 'post'],
            ['/pets/{petId}/leave', 'post'],
            ['/pets/{petId}/archive', 'post'],
            ['/pets/{petId}/restore', 'post'],
            ['/pets/{petId}/health/medical-conditions', 'post'],
            ['/pets/{petId}/health/medical-conditions', 'get'],
            ['/pets/{petId}/health/medical-conditions/{conditionId}', 'patch'],
            ['/pets/{petId}/health/allergies', 'post'],
            ['/pets/{petId}/health/allergies', 'get'],
            ['/pets/{petId}/health/allergies/{allergyId}', 'patch'],
            ['/pets/{petId}/health/allergies/{allergyId}', 'delete'],
            ['/pets/{petId}/health/weight-records', 'post'],
            ['/pets/{petId}/health/weight-records', 'get'],
            ['/pets/{petId}/health/weight-records/{weightRecordId}', 'patch'],
            ['/pets/{petId}/health/weight-records/{weightRecordId}', 'delete'],
            ['/pets/{petId}/health/vaccination-records', 'post'],
            ['/pets/{petId}/health/vaccination-records', 'get'],
            ['/pets/{petId}/health/vaccination-records/{vaccinationRecordId}', 'patch'],
            ['/pets/{petId}/health/vaccination-records/{vaccinationRecordId}', 'delete'],
            ['/pet-invitations/{invitationId}/accept', 'post'],
            ['/pet-invitations/{invitationId}/reject', 'post'],
            ['/pet-invitations/{invitationId}/cancel', 'post'],
        ];

        for (const [path, method] of routes) {
            const operation: OperationObject | undefined =
                document.paths[path]?.[method as 'get' | 'post' | 'patch' | 'delete'];

            expect(operation).toBeDefined();
            expect(operation?.summary).toBeTruthy();
        }

        expect(
            Object.values(document.paths).reduce(
                (count: number, path) =>
                    count +
                    Number(Boolean(path?.get)) +
                    Number(Boolean(path?.post)) +
                    Number(Boolean(path?.patch)) +
                    Number(Boolean(path?.delete)),
                0,
            ),
        ).toBe(32);

        const medicalCondition: OperationObject | undefined =
            document.paths['/pets/{petId}/health/medical-conditions']?.post;

        expect(medicalCondition?.security).toEqual([{ bearer: [] }]);
        expect(Object.keys(medicalCondition?.responses ?? {}).sort()).toEqual([
            '201',
            '400',
            '401',
            '404',
        ]);
        expect(medicalCondition?.parameters).toEqual([
            expect.objectContaining({
                name: 'petId',
                in: 'path',
                required: true,
                schema: { type: 'string', format: 'uuid' },
            }),
        ]);
        const medicalConditionRequest = (
            medicalCondition?.requestBody as {
                content: { 'application/json': { schema: SchemaObject } };
            }
        ).content['application/json'].schema;

        expect(medicalConditionRequest).toMatchObject({
            type: 'object',
            additionalProperties: false,
            required: ['name'],
        });
        expect(Object.keys(medicalConditionRequest.properties ?? {}).sort()).toEqual([
            'diagnosedDate',
            'name',
            'notes',
        ]);
        expect(medicalConditionRequest.properties?.name).toMatchObject({
            type: 'string',
            minLength: 1,
            maxLength: 255,
        });
        expect(medicalConditionRequest.properties?.name).not.toHaveProperty('nullable', true);
        expect(medicalConditionRequest.properties?.diagnosedDate).toMatchObject({
            type: 'string',
            format: 'date',
            nullable: true,
        });
        expect(medicalConditionRequest.properties?.notes).toMatchObject({
            type: 'string',
            nullable: true,
            minLength: 1,
            maxLength: 2000,
        });
        const medicalConditionResponse = responseSchema(medicalCondition, '201');

        expect(medicalConditionResponse?.additionalProperties).toBe(false);
        expect(medicalConditionResponse?.required).toEqual([
            'id',
            'petId',
            'name',
            'status',
            'diagnosedDate',
            'notes',
            'recordedByAccountId',
        ]);
        expect(Object.keys(medicalConditionResponse?.properties ?? {}).sort()).toEqual([
            'diagnosedDate',
            'id',
            'name',
            'notes',
            'petId',
            'recordedByAccountId',
            'status',
        ]);
        expect(medicalConditionResponse?.properties?.status).toMatchObject({
            enum: ['ACTIVE'],
        });
        expect(medicalConditionResponse?.properties?.diagnosedDate).toMatchObject({
            format: 'date',
            nullable: true,
        });
        expect(medicalConditionResponse?.properties?.notes).toMatchObject({
            nullable: true,
            maxLength: 2000,
        });

        for (const field of ['id', 'petId', 'recordedByAccountId']) {
            expect(medicalConditionResponse?.properties?.[field]).toMatchObject({
                type: 'string',
                format: 'uuid',
            });
        }

        for (const code of [
            'INVALID_REQUEST',
            'INVALID_MEDICAL_CONDITION_NAME',
            'INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE',
            'INVALID_MEDICAL_CONDITION_NOTES',
        ]) {
            expect(JSON.stringify(responseSchema(medicalCondition, '400'))).toContain(code);
        }

        expect(JSON.stringify(responseSchema(medicalCondition, '401'))).toContain(
            'UNAUTHENTICATED',
        );
        expect(JSON.stringify(responseSchema(medicalCondition, '404'))).toContain('PET_NOT_FOUND');

        for (const method of ['patch', 'delete'] as const) {
            expect(
                document.paths['/pets/{petId}/health/medical-conditions']?.[method],
            ).toBeUndefined();
        }

        const medicalConditionUpdate =
            document.paths['/pets/{petId}/health/medical-conditions/{conditionId}']?.patch;

        expect(medicalConditionUpdate?.security).toEqual([{ bearer: [] }]);
        expect(Object.keys(medicalConditionUpdate?.responses ?? {}).sort()).toEqual([
            '200',
            '400',
            '401',
            '404',
        ]);
        expect(medicalConditionUpdate?.parameters).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'petId',
                    in: 'path',
                    required: true,
                    schema: { type: 'string', format: 'uuid' },
                }),
                expect.objectContaining({
                    name: 'conditionId',
                    in: 'path',
                    required: true,
                    schema: { type: 'string', format: 'uuid' },
                }),
            ]),
        );
        expect(medicalConditionUpdate?.parameters).toHaveLength(2);
        const updateRequest = (
            medicalConditionUpdate?.requestBody as {
                content: { 'application/json': { schema: SchemaObject } };
            }
        ).content['application/json'].schema;

        expect(updateRequest).toMatchObject({
            type: 'object',
            additionalProperties: false,
            minProperties: 1,
        });
        expect(updateRequest.required ?? []).toEqual([]);
        expect(Object.keys(updateRequest.properties ?? {}).sort()).toEqual([
            'diagnosedDate',
            'name',
            'notes',
        ]);
        expect(updateRequest.properties?.name).not.toHaveProperty('nullable', true);
        expect(updateRequest.properties?.diagnosedDate).toMatchObject({
            format: 'date',
            nullable: true,
        });
        expect(updateRequest.properties?.notes).toMatchObject({
            nullable: true,
            maxLength: 2000,
        });
        expect(medicalConditionUpdate?.description).toContain('Update does not Resolve or Reopen');
        const updateResponse = responseSchema(medicalConditionUpdate, '200');

        expect(updateResponse?.required).toEqual(medicalConditionResponse?.required);
        expect(updateResponse?.additionalProperties).toBe(false);
        expect(Object.keys(updateResponse?.properties ?? {}).sort()).toEqual(
            Object.keys(medicalConditionResponse?.properties ?? {}).sort(),
        );
        expect(updateResponse?.properties?.status).toMatchObject({
            enum: ['ACTIVE', 'RESOLVED'],
        });

        for (const code of [
            'INVALID_REQUEST',
            'INVALID_MEDICAL_CONDITION_NAME',
            'INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE',
            'INVALID_MEDICAL_CONDITION_NOTES',
        ]) {
            expect(JSON.stringify(responseSchema(medicalConditionUpdate, '400'))).toContain(code);
        }

        for (const code of ['PET_NOT_FOUND', 'PET_MEDICAL_CONDITION_NOT_FOUND']) {
            expect(JSON.stringify(responseSchema(medicalConditionUpdate, '404'))).toContain(code);
        }

        expect(JSON.stringify(responseSchema(medicalConditionUpdate, '401'))).toContain(
            'UNAUTHENTICATED',
        );
        const conditionDetailPath =
            document.paths['/pets/{petId}/health/medical-conditions/{conditionId}'];

        expect(conditionDetailPath?.get).toBeUndefined();
        expect(conditionDetailPath?.delete).toBeUndefined();
        expect(
            Object.keys(document.paths).some(
                (path: string): boolean =>
                    path.includes('medical-conditions') && /\/(resolve|reopen)$/.test(path),
            ),
        ).toBe(false);

        const medicalConditionList: OperationObject | undefined =
            document.paths['/pets/{petId}/health/medical-conditions']?.get;

        expect(medicalConditionList?.security).toEqual([{ bearer: [] }]);
        expect(Object.keys(medicalConditionList?.responses ?? {}).sort()).toEqual([
            '200',
            '400',
            '401',
            '404',
        ]);
        expect(medicalConditionList?.requestBody).toBeUndefined();
        expect(medicalConditionList?.parameters).toEqual([
            expect.objectContaining({
                name: 'petId',
                in: 'path',
                required: true,
                schema: { type: 'string', format: 'uuid' },
            }),
        ]);
        const medicalConditionListResponse: SchemaObject | undefined = responseSchema(
            medicalConditionList,
            '200',
        );

        expect(medicalConditionListResponse?.required).toEqual(['items']);
        expect(medicalConditionListResponse?.additionalProperties).toBe(false);
        expect(Object.keys(medicalConditionListResponse?.properties ?? {})).toEqual(['items']);
        const medicalConditionListItems: SchemaObject = medicalConditionListResponse?.properties
            ?.items as SchemaObject;

        expect(medicalConditionListItems.type).toBe('array');
        const medicalConditionListItem: SchemaObject =
            medicalConditionListItems.items as SchemaObject;

        expect(medicalConditionListItem.additionalProperties).toBe(false);
        expect(medicalConditionListItem.required).toEqual([
            'id',
            'name',
            'status',
            'diagnosedDate',
            'notes',
            'recordedByAccountId',
        ]);
        expect(Object.keys(medicalConditionListItem.properties ?? {}).sort()).toEqual([
            'diagnosedDate',
            'id',
            'name',
            'notes',
            'recordedByAccountId',
            'status',
        ]);
        expect(medicalConditionListItem.properties?.status).toMatchObject({
            type: 'string',
            enum: ['ACTIVE', 'RESOLVED'],
        });
        expect(medicalConditionListItem.properties?.diagnosedDate).toMatchObject({
            type: 'string',
            format: 'date',
            nullable: true,
        });
        expect(medicalConditionListItem.properties?.notes).toMatchObject({
            type: 'string',
            nullable: true,
            maxLength: 2000,
        });

        for (const field of ['id', 'recordedByAccountId']) {
            expect(medicalConditionListItem.properties?.[field]).toMatchObject({
                type: 'string',
                format: 'uuid',
            });
        }

        for (const [status, code] of [
            ['400', 'INVALID_REQUEST'],
            ['401', 'UNAUTHENTICATED'],
            ['404', 'PET_NOT_FOUND'],
        ]) {
            expect(JSON.stringify(responseSchema(medicalConditionList, status))).toContain(code);
        }

        const allergyUpdate: OperationObject | undefined =
            document.paths['/pets/{petId}/health/allergies/{allergyId}']?.patch;

        expect(allergyUpdate?.security).toEqual([{ bearer: [] }]);
        expect(Object.keys(allergyUpdate?.responses ?? {}).sort()).toEqual([
            '200',
            '400',
            '401',
            '404',
        ]);
        expect(allergyUpdate?.parameters).toEqual([
            expect.objectContaining({
                name: 'petId',
                in: 'path',
                required: true,
                schema: { type: 'string', format: 'uuid' },
            }),
            expect.objectContaining({
                name: 'allergyId',
                in: 'path',
                required: true,
                schema: { type: 'string', format: 'uuid' },
            }),
        ]);
        const allergyUpdateRequest = (
            allergyUpdate?.requestBody as {
                content: { 'application/json': { schema: SchemaObject } };
            }
        ).content['application/json'].schema;

        expect(allergyUpdateRequest).toMatchObject({
            type: 'object',
            additionalProperties: false,
            minProperties: 1,
        });
        expect(allergyUpdateRequest.required ?? []).toEqual([]);
        expect(Object.keys(allergyUpdateRequest.properties ?? {}).sort()).toEqual([
            'allergen',
            'category',
            'notes',
            'severity',
        ]);
        expect(allergyUpdateRequest.properties?.notes).toMatchObject({
            type: 'string',
            nullable: true,
            minLength: 1,
            maxLength: 2000,
        });

        for (const field of ['allergen', 'category', 'severity']) {
            expect(allergyUpdateRequest.properties?.[field]).not.toHaveProperty('nullable', true);
        }

        for (const code of [
            'INVALID_REQUEST',
            'INVALID_ALLERGEN',
            'INVALID_ALLERGY_CATEGORY',
            'INVALID_ALLERGY_SEVERITY',
            'INVALID_ALLERGY_NOTES',
        ]) {
            expect(JSON.stringify(responseSchema(allergyUpdate, '400'))).toContain(code);
        }

        for (const code of ['PET_NOT_FOUND', 'PET_ALLERGY_NOT_FOUND']) {
            expect(JSON.stringify(responseSchema(allergyUpdate, '404'))).toContain(code);
        }

        expect(JSON.stringify(responseSchema(allergyUpdate, '401'))).toContain('UNAUTHENTICATED');
        expect(responseSchema(allergyUpdate, '200')).toEqual(
            responseSchema(document.paths['/pets/{petId}/health/allergies']?.post, '201'),
        );
        const allergyDelete: OperationObject | undefined =
            document.paths['/pets/{petId}/health/allergies/{allergyId}']?.delete;

        expect(allergyDelete?.security).toEqual([{ bearer: [] }]);
        expect(Object.keys(allergyDelete?.responses ?? {}).sort()).toEqual([
            '204',
            '400',
            '401',
            '404',
        ]);
        expect(allergyDelete?.requestBody).toBeUndefined();
        expect(allergyDelete?.parameters).toEqual(allergyUpdate?.parameters);
        expect(allergyDelete?.responses['204']).not.toHaveProperty('content');
        expect(JSON.stringify(responseSchema(allergyDelete, '400'))).toContain('INVALID_REQUEST');
        expect(JSON.stringify(responseSchema(allergyDelete, '401'))).toContain('UNAUTHENTICATED');

        for (const code of ['PET_NOT_FOUND', 'PET_ALLERGY_NOT_FOUND']) {
            expect(JSON.stringify(responseSchema(allergyDelete, '404'))).toContain(code);
        }

        for (const description of [
            'Hard delete',
            'clinical resolution',
            'Archived pets are read-only',
            'second DELETE',
        ]) {
            expect(allergyDelete?.description).toContain(description);
        }

        const allergy: OperationObject | undefined =
            document.paths['/pets/{petId}/health/allergies']?.post;

        expect(Object.keys(allergy?.responses ?? {}).sort()).toEqual(['201', '400', '401', '404']);
        expect(allergy?.security).toEqual([{ bearer: [] }]);
        const allergyRequest = (
            allergy?.requestBody as {
                content: { 'application/json': { schema: SchemaObject } };
            }
        ).content['application/json'].schema;

        expect(allergyRequest.additionalProperties).toBe(false);
        expect(allergyRequest.required).toEqual(['allergen', 'category', 'severity']);
        expect(Object.keys(allergyRequest.properties ?? {}).sort()).toEqual([
            'allergen',
            'category',
            'notes',
            'severity',
        ]);
        expect(allergyRequest.properties?.allergen).toMatchObject({
            type: 'string',
            maxLength: 255,
        });
        expect(allergyRequest.properties?.category).toMatchObject({
            enum: ['FOOD', 'MEDICATION', 'ENVIRONMENTAL', 'OTHER'],
        });
        expect(allergyRequest.properties?.severity).toMatchObject({
            enum: ['MILD', 'MODERATE', 'SEVERE', 'UNKNOWN'],
        });
        expect(allergyRequest.properties?.notes).toMatchObject({
            nullable: true,
            maxLength: 2000,
        });
        const allergyResponse: SchemaObject | undefined = responseSchema(allergy, '201');

        expect(allergyResponse?.required).toEqual([
            'id',
            'petId',
            'allergen',
            'category',
            'severity',
            'notes',
            'recordedByAccountId',
        ]);
        expect(Object.keys(allergyResponse?.properties ?? {}).sort()).toEqual([
            'allergen',
            'category',
            'id',
            'notes',
            'petId',
            'recordedByAccountId',
            'severity',
        ]);
        const allergyErrors: string = JSON.stringify(responseSchema(allergy, '400'));

        for (const code of [
            'INVALID_REQUEST',
            'INVALID_ALLERGEN',
            'INVALID_ALLERGY_CATEGORY',
            'INVALID_ALLERGY_SEVERITY',
            'INVALID_ALLERGY_NOTES',
        ]) {
            expect(allergyErrors).toContain(code);
        }

        expect(JSON.stringify(responseSchema(allergy, '401'))).toContain('UNAUTHENTICATED');
        expect(JSON.stringify(responseSchema(allergy, '404'))).toContain('PET_NOT_FOUND');
        const allergyList: OperationObject | undefined =
            document.paths['/pets/{petId}/health/allergies']?.get;

        expect(Object.keys(allergyList?.responses ?? {}).sort()).toEqual([
            '200',
            '400',
            '401',
            '404',
        ]);
        expect(allergyList?.security).toEqual([{ bearer: [] }]);
        expect(allergyList?.requestBody).toBeUndefined();
        expect(allergyList?.parameters).toEqual([
            {
                name: 'petId',
                in: 'path',
                required: true,
                description: 'Non-nil pet UUID',
                schema: { type: 'string', format: 'uuid' },
            },
        ]);
        const allergyListResponse: SchemaObject | undefined = responseSchema(allergyList, '200');

        expect(allergyListResponse?.required).toEqual(['items']);
        expect(Object.keys(allergyListResponse?.properties ?? {})).toEqual(['items']);
        const allergyListItems: SchemaObject = allergyListResponse?.properties
            ?.items as SchemaObject;

        expect(allergyListItems.type).toBe('array');
        const allergyListItem: SchemaObject = allergyListItems.items as SchemaObject;

        expect(allergyListItem.required).toEqual([
            'id',
            'allergen',
            'category',
            'severity',
            'notes',
            'recordedByAccountId',
        ]);
        expect(Object.keys(allergyListItem.properties ?? {}).sort()).toEqual([
            'allergen',
            'category',
            'id',
            'notes',
            'recordedByAccountId',
            'severity',
        ]);
        expect(allergyListItem.properties?.category).toMatchObject({
            enum: ['FOOD', 'MEDICATION', 'ENVIRONMENTAL', 'OTHER'],
        });
        expect(allergyListItem.properties?.severity).toMatchObject({
            enum: ['MILD', 'MODERATE', 'SEVERE', 'UNKNOWN'],
        });
        expect(allergyListItem.properties?.notes).toMatchObject({
            type: 'string',
            nullable: true,
            maxLength: 2000,
        });

        for (const [status, code] of [
            ['400', 'INVALID_REQUEST'],
            ['401', 'UNAUTHENTICATED'],
            ['404', 'PET_NOT_FOUND'],
        ]) {
            expect(JSON.stringify(responseSchema(allergyList, status))).toContain(code);
        }

        expect(document.paths['/pets/{petId}/health/allergies']?.patch).toBeUndefined();
        expect(document.paths['/pets/{petId}/health/allergies']?.delete).toBeUndefined();

        const archive: OperationObject | undefined = document.paths['/pets/{petId}/archive']?.post;

        expect(Object.keys(archive?.responses ?? {}).sort()).toEqual(['204', '400', '401', '404']);
        expect((archive?.responses['204'] as ResponseObject).content).toBeUndefined();
        expect(archive?.requestBody).toBeUndefined();
        expect(archive?.security).toEqual([{ bearer: [] }]);
        expect(archive?.parameters).toEqual([
            expect.objectContaining({
                name: 'petId',
                in: 'path',
                required: true,
                schema: { type: 'string', format: 'uuid' },
            }),
        ]);

        for (const [status, code] of [
            ['400', 'INVALID_REQUEST'],
            ['401', 'UNAUTHENTICATED'],
            ['404', 'PET_NOT_FOUND'],
        ]) {
            expect(responseSchema(archive, status)?.properties?.code).toMatchObject({
                enum: [code],
            });
        }

        const restore: OperationObject | undefined = document.paths['/pets/{petId}/restore']?.post;

        expect(Object.keys(restore?.responses ?? {}).sort()).toEqual(['204', '400', '401', '404']);
        expect((restore?.responses['204'] as ResponseObject).content).toBeUndefined();
        expect(restore?.requestBody).toBeUndefined();
        expect(restore?.security).toEqual([{ bearer: [] }]);
        expect(restore?.parameters).toEqual([
            expect.objectContaining({
                name: 'petId',
                in: 'path',
                required: true,
                schema: { type: 'string', format: 'uuid' },
            }),
        ]);

        for (const [status, code] of [
            ['400', 'INVALID_REQUEST'],
            ['401', 'UNAUTHENTICATED'],
            ['404', 'PET_NOT_FOUND'],
        ]) {
            expect(responseSchema(restore, status)?.properties?.code).toMatchObject({
                enum: [code],
            });
        }

        const summary = responseSchema(document.paths['/pets']?.get, '200')?.items as SchemaObject;

        expect(summary.required).toContain('status');
        expect(summary.properties?.status).toMatchObject({
            enum: ['ACTIVE', 'ARCHIVED'],
        });

        const promotion: OperationObject | undefined =
            document.paths['/pets/{petId}/members/{membershipId}/promote']?.post;

        expect(Object.keys(promotion?.responses ?? {}).sort()).toEqual([
            '204',
            '400',
            '401',
            '404',
            '409',
        ]);
        expect((promotion?.responses['204'] as ResponseObject).content).toBeUndefined();
        expect(promotion?.security).toEqual([{ bearer: [] }]);
        expect(promotion?.parameters).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'petId', in: 'path', required: true }),
                expect.objectContaining({
                    name: 'membershipId',
                    in: 'path',
                    required: true,
                }),
            ]),
        );
        expect(responseSchema(promotion, '409')?.properties?.code).toMatchObject({
            enum: ['PET_MEMBER_INACTIVE'],
        });

        const removal: OperationObject | undefined =
            document.paths['/pets/{petId}/members/{membershipId}']?.delete;

        expect(Object.keys(removal?.responses ?? {}).sort()).toEqual([
            '204',
            '400',
            '401',
            '404',
            '409',
        ]);
        expect((removal?.responses['204'] as ResponseObject).content).toBeUndefined();
        expect(removal?.parameters).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'petId', in: 'path', required: true }),
                expect.objectContaining({
                    name: 'membershipId',
                    in: 'path',
                    required: true,
                }),
            ]),
        );
        const missingSchemas = responseSchema(removal, '404')?.oneOf as SchemaObject[];

        expect(
            missingSchemas.map((schema): unknown => (schema.properties?.code as SchemaObject).enum),
        ).toEqual([['PET_NOT_FOUND'], ['PET_MEMBER_NOT_FOUND']]);
        expect(JSON.stringify(responseSchema(removal, '409'))).not.toContain(
            'LAST_OWNER_CANNOT_BE_REMOVED',
        );
        expect(responseSchema(removal, '409')).toMatchObject({
            properties: { code: { enum: ['SELF_REMOVAL_NOT_SUPPORTED'] } },
        });

        expect(document.components?.securitySchemes?.bearer).toMatchObject({
            type: 'http',
            scheme: 'bearer',
        });

        for (const [path, method] of routes) {
            const operation: OperationObject | undefined =
                document.paths[path]?.[method as 'get' | 'post' | 'patch' | 'delete'];

            expect(operation?.security ?? []).toEqual(
                path.startsWith('/pets') || path.startsWith('/pet-invitations')
                    ? [{ bearer: [] }]
                    : [],
            );
        }

        const account = document.paths['/accounts']?.post;
        const login = document.paths['/auth/login']?.post;
        const list = document.paths['/pets']?.get;
        const detail = document.paths['/pets/{petId}']?.get;
        const members = document.paths['/pets/{petId}/members']?.get;

        expect(Object.keys(members?.responses ?? {}).sort()).toEqual(['200', '400', '401', '404']);
        expect(members?.requestBody).toBeUndefined();
        expect(members?.parameters).toEqual([
            expect.objectContaining({
                name: 'petId',
                in: 'path',
                required: true,
                schema: { type: 'string', format: 'uuid' },
            }),
        ]);
        expect(responseSchema(members, '200')).toEqual({
            type: 'object',
            additionalProperties: false,
            required: ['members'],
            properties: {
                members: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['membershipId', 'accountId', 'email', 'role'],
                        properties: {
                            membershipId: { type: 'string', format: 'uuid' },
                            accountId: { type: 'string', format: 'uuid' },
                            email: {
                                type: 'string',
                                format: 'email',
                                example: 'owner@example.com',
                            },
                            role: { type: 'string', enum: ['OWNER', 'COLLABORATOR'] },
                        },
                    },
                },
            },
        });
        const profileUpdate = document.paths['/pets/{petId}']?.patch;

        expect(profileUpdate?.responses['200']).toBeDefined();
        expect(profileUpdate?.responses['400']).toBeDefined();
        expect(profileUpdate?.responses['401']).toBeDefined();
        expect(profileUpdate?.responses['404']).toBeDefined();
        expect(profileUpdate?.responses['422']).toBeDefined();
        const profileRequest =
            profileUpdate?.requestBody && 'content' in profileUpdate.requestBody
                ? (profileUpdate.requestBody.content['application/json']?.schema as SchemaObject)
                : undefined;

        expect(profileRequest).toMatchObject({
            type: 'object',
            minProperties: 1,
            additionalProperties: false,
        });

        for (const field of ['color', 'distinctiveMarks', 'microchip']) {
            expect(profileRequest?.properties?.[field]).toMatchObject({
                nullable: true,
            });
        }

        expect(responseSchema(profileUpdate, '200')).toEqual(responseSchema(detail, '200'));
        const create = document.paths['/pets']?.post;
        const invite = document.paths['/pets/{petId}/invitations']?.post;
        const leave = document.paths['/pets/{petId}/leave']?.post;
        const weight = document.paths['/pets/{petId}/health/weight-records']?.post;
        const weightHistory = document.paths['/pets/{petId}/health/weight-records']?.get;
        const weightUpdate =
            document.paths['/pets/{petId}/health/weight-records/{weightRecordId}']?.patch;
        const weightDelete =
            document.paths['/pets/{petId}/health/weight-records/{weightRecordId}']?.delete;
        const vaccination = document.paths['/pets/{petId}/health/vaccination-records']?.post;
        const vaccinationHistory = document.paths['/pets/{petId}/health/vaccination-records']?.get;
        const vaccinationUpdate =
            document.paths['/pets/{petId}/health/vaccination-records/{vaccinationRecordId}']?.patch;
        const vaccinationDelete =
            document.paths['/pets/{petId}/health/vaccination-records/{vaccinationRecordId}']
                ?.delete;

        expect(vaccinationUpdate?.responses['200']).toBeDefined();
        expect(vaccinationUpdate?.responses['400']).toBeDefined();
        expect(vaccinationUpdate?.responses['401']).toBeDefined();
        expect(vaccinationUpdate?.responses['404']).toBeDefined();
        expect(vaccinationDelete?.responses['204']).toBeDefined();
        expect(vaccinationDelete?.responses['400']).toBeDefined();
        expect(vaccinationDelete?.responses['401']).toBeDefined();
        expect(vaccinationDelete?.responses['404']).toBeDefined();
        expect(vaccinationDelete?.requestBody).toBeUndefined();
        const vaccinationUpdateRequest =
            vaccinationUpdate?.requestBody && 'content' in vaccinationUpdate.requestBody
                ? (vaccinationUpdate.requestBody.content['application/json']
                      ?.schema as SchemaObject)
                : undefined;

        expect(vaccinationUpdateRequest).toMatchObject({
            type: 'object',
            minProperties: 1,
            additionalProperties: false,
        });
        expect(vaccinationUpdateRequest?.properties?.nextDueDate).toMatchObject({
            nullable: true,
        });
        expect(responseSchema(vaccinationUpdate, '200')?.required).toEqual([
            'id',
            'petId',
            'vaccineName',
            'appliedDate',
            'nextDueDate',
            'recordedByAccountId',
        ]);
        const vaccinationUpdateBadRequest = responseSchema(vaccinationUpdate, '400');

        expect(vaccinationUpdateBadRequest?.oneOf).toMatchObject([
            { properties: { code: { enum: ['INVALID_REQUEST'] } } },
            { properties: { code: { enum: ['INVALID_VACCINE_NAME'] } } },
            { properties: { code: { enum: ['INVALID_APPLIED_DATE'] } } },
            { properties: { code: { enum: ['INVALID_NEXT_DUE_DATE'] } } },
        ]);

        for (const operation of [vaccinationUpdate, vaccinationDelete]) {
            expect(responseSchema(operation, '404')?.oneOf).toMatchObject([
                { properties: { code: { enum: ['PET_NOT_FOUND'] } } },
                { properties: { code: { enum: ['VACCINATION_RECORD_NOT_FOUND'] } } },
            ]);
            expect(operation?.parameters).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'petId',
                        in: 'path',
                        required: true,
                    }),
                    expect.objectContaining({
                        name: 'vaccinationRecordId',
                        in: 'path',
                        required: true,
                    }),
                ]),
            );
        }

        expect(vaccinationHistory?.responses['200']).toBeDefined();
        expect(vaccinationHistory?.responses['400']).toBeDefined();
        expect(vaccinationHistory?.responses['401']).toBeDefined();
        expect(vaccinationHistory?.responses['404']).toBeDefined();
        const historySchema = responseSchema(vaccinationHistory, '200');

        expect(historySchema?.required).toEqual(['items', 'nextCursor']);
        const historyItems = historySchema?.properties?.items as SchemaObject | undefined;
        const historyItem = historyItems?.items as SchemaObject | undefined;

        expect(historyItem?.properties?.nextDueDate).toMatchObject({
            nullable: true,
        });
        expect(historyItem?.properties?.createdAt).toBeUndefined();
        expect(vaccination?.responses['201']).toBeDefined();
        expect(vaccination?.responses['400']).toBeDefined();
        expect(vaccination?.responses['401']).toBeDefined();
        expect(vaccination?.responses['404']).toBeDefined();
        const vaccinationRequest =
            vaccination?.requestBody && 'content' in vaccination.requestBody
                ? (vaccination.requestBody.content['application/json']?.schema as SchemaObject)
                : undefined;

        expect(vaccinationRequest?.required).toEqual(['vaccineName', 'appliedDate']);
        expect(vaccinationRequest?.properties?.nextDueDate).toMatchObject({
            nullable: true,
        });
        expect(responseSchema(vaccination, '201')?.required).toContain('nextDueDate');
        expect(weightUpdate?.responses['200']).toBeDefined();
        expect(weightUpdate?.responses['400']).toBeDefined();
        expect(weightUpdate?.responses['404']).toBeDefined();
        expect(weightDelete?.responses['204']).toBeDefined();
        expect(weightDelete?.responses['400']).toBeDefined();
        expect(weightDelete?.responses['404']).toBeDefined();
        const accept = document.paths['/pet-invitations/{invitationId}/accept']?.post;
        const reject = document.paths['/pet-invitations/{invitationId}/reject']?.post;
        const cancel = document.paths['/pet-invitations/{invitationId}/cancel']?.post;

        for (const operation of [account, login, create, invite, weight, vaccination]) {
            const requestSchema =
                operation?.requestBody && 'content' in operation.requestBody
                    ? (operation.requestBody.content['application/json']?.schema as SchemaObject)
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

        for (const operation of [
            list,
            detail,
            create,
            invite,
            accept,
            leave,
            weight,
            weightHistory,
            weightUpdate,
            weightDelete,
            vaccination,
            vaccinationHistory,
            vaccinationUpdate,
            vaccinationDelete,
        ]) {
            expect(operation?.responses['401']).toBeDefined();
        }

        for (const operation of [
            detail,
            invite,
            leave,
            weight,
            weightHistory,
            vaccination,
            vaccinationHistory,
        ]) {
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
                ? (create.requestBody.content['application/json']?.schema as SchemaObject)
                : undefined;

        expect(petRequestSchema?.required).toEqual(
            expect.arrayContaining(['name', 'species', 'breed', 'sex', 'birthInformation']),
        );
        expect(petRequestSchema?.properties?.species).toMatchObject({
            enum: ['DOG', 'CAT'],
        });
        expect(petRequestSchema?.properties?.color).toBeDefined();
        expect(accept?.requestBody).toBeUndefined();
        expect(reject?.requestBody).toBeUndefined();
        expect(cancel?.requestBody).toBeUndefined();
        expect(leave?.requestBody).toBeUndefined();
        expect(responseSchema(weight, '201')).toMatchObject({
            required: ['id', 'petId', 'weightKg', 'measuredDate', 'recordedByAccountId'],
        });
        expect(weight?.responses['404']).toBeDefined();
        expect(weightHistory?.requestBody).toBeUndefined();
        expect(responseSchema(weightHistory, '200')?.required).toEqual(['items', 'nextCursor']);
        expect(responseSchema(weightHistory, '200')?.properties?.items).toMatchObject({
            type: 'array',
            items: {
                required: ['id', 'weightKg', 'measuredDate', 'recordedByAccountId'],
            },
        });
        expect(weightHistory?.parameters).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'limit',
                    in: 'query',
                    required: false,
                }) as object,
                expect.objectContaining({
                    name: 'cursor',
                    in: 'query',
                    required: false,
                }) as object,
            ]),
        );

        for (const status of ['400', '401', '404']) {
            expect(weightHistory?.responses[status]).toBeDefined();
        }

        expect(responseSchema(weight, '400')?.oneOf).toMatchObject([
            { properties: { code: { enum: ['INVALID_REQUEST'] } } },
            { properties: { code: { enum: ['INVALID_WEIGHT'] } } },
            { properties: { code: { enum: ['INVALID_MEASURED_DATE'] } } },
        ]);
        expect(accept?.responses['200']).toBeDefined();
        expect(reject?.responses['200']).toBeDefined();
        expect(cancel?.responses['200']).toBeDefined();
        expect(leave?.responses['204']).toBeDefined();
        expect((leave?.responses['204'] as ResponseObject).content).toBeUndefined();
        expect(leave?.responses['200']).toBeUndefined();

        for (const status of ['400', '401', '404', '409']) {
            expect(leave?.responses[status]).toBeDefined();
        }

        for (const status of ['400', '401', '404', '409', '410']) {
            expect(accept?.responses[status]).toBeDefined();
            expect(reject?.responses[status]).toBeDefined();
            expect(cancel?.responses[status]).toBeDefined();
        }

        expect(responseSchema(cancel, '200')?.properties?.status).toMatchObject({
            enum: ['CANCELLED'],
        });
        expect(cancel?.parameters).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'invitationId',
                    in: 'path',
                    required: true,
                    schema: expect.objectContaining({ format: 'uuid' }) as object,
                }) as object,
            ]),
        );
        const cancellationNotFound = responseSchema(cancel, '404');

        expect(cancellationNotFound?.oneOf).toMatchObject([
            {
                required: ['code', 'message'],
                properties: {
                    code: { enum: ['INVITATION_NOT_FOUND'] },
                    message: { example: 'Invitation was not found' },
                },
            },
            {
                required: ['code', 'message'],
                properties: {
                    code: { enum: ['PET_NOT_FOUND'] },
                    message: { example: 'Pet was not found' },
                },
            },
        ]);
        expect(responseSchema(reject, '200')?.properties?.status).toMatchObject({
            enum: ['REJECTED'],
        });
        expect(reject?.parameters).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'invitationId',
                    in: 'path',
                    required: true,
                    schema: expect.objectContaining({ format: 'uuid' }) as object,
                }) as object,
            ]),
        );
        expect(responseSchema(accept, '200')?.required).toEqual(['id', 'petId', 'status']);
        expect(accept?.parameters).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'invitationId',
                    in: 'path',
                    required: true,
                    schema: expect.objectContaining({ format: 'uuid' }) as object,
                }) as object,
            ]),
        );
        expect(petRequestSchema?.required).not.toContain('color');
        expect(petRequestSchema?.additionalProperties).toBe(false);

        expect(responseSchema(account, '201')?.required).toEqual(['id', 'email']);
        expect(responseSchema(login, '200')?.required).toEqual(['accessToken']);
        expect(responseSchema(list, '200')).toMatchObject({ type: 'array' });
        expect(responseSchema(detail, '200')?.required).toContain('role');
        expect(responseSchema(create, '201')?.required).toContain('memberships');
        expect(responseSchema(invite, '201')?.required).toEqual(
            expect.arrayContaining(['id', 'petId', 'email', 'status', 'createdAt', 'expiresAt']),
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
            [members, '400', ['INVALID_REQUEST']],
            [members, '401', ['UNAUTHENTICATED']],
            [members, '404', ['PET_NOT_FOUND']],
            [create, '422', ['INVALID_PET']],
            [invite, '409', ['ALREADY_PET_MEMBER', 'INVITATION_ALREADY_PENDING']],
            [reject, '400', ['INVALID_REQUEST']],
            [reject, '401', ['UNAUTHENTICATED']],
            [reject, '404', ['INVITATION_NOT_FOUND']],
            [reject, '409', ['INVITATION_NOT_PENDING']],
            [reject, '410', ['INVITATION_EXPIRED']],
            [cancel, '400', ['INVALID_REQUEST']],
            [cancel, '401', ['UNAUTHENTICATED']],
            [cancel, '409', ['INVITATION_NOT_PENDING']],
            [cancel, '410', ['INVITATION_EXPIRED']],
            [leave, '400', ['INVALID_REQUEST']],
            [leave, '401', ['UNAUTHENTICATED']],
            [leave, '404', ['PET_NOT_FOUND']],
            [leave, '409', ['LAST_OWNER_CANNOT_LEAVE']],
            [weightHistory, '400', ['INVALID_REQUEST']],
            [weightHistory, '404', ['PET_NOT_FOUND']],
        ];

        for (const [operation, status, codes] of errorCases) {
            expect(responseSchema(operation, status)?.required).toEqual(['code', 'message']);
            expect(responseSchema(operation, status)?.properties?.code).toMatchObject({
                enum: codes,
            });
        }
    });
});
