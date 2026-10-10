import type {
    VaccinationHistoryReadRequest,
    VaccinationHistoryReader,
    VaccinationHistoryRow,
} from '../persistence/vaccination-history.reader';
import { ListPetVaccinationHistory, PetNotFoundError } from './list-pet-vaccination-history';
import {
    decodeVaccinationHistoryCursor,
    encodeVaccinationHistoryCursor,
    InvalidVaccinationHistoryCursorError,
} from './vaccination-history-cursor';

const PET_ID = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const OTHER_PET_ID = '4ada58ea-14fc-4642-846b-b2fc8d51e246';
const ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';
const FIRST_ID = '80db31a0-aeb9-4768-b103-770110b39fd8';
const SECOND_ID = '7197fb48-3906-4da9-86d7-8323e04d7725';

const first: VaccinationHistoryRow = {
    id: FIRST_ID,
    vaccineName: 'Rabies',
    appliedDate: '2026-09-20',
    nextDueDate: null,
    createdAt: '2026-09-26T12:00:00.123456Z',
    recordedByAccountId: ACCOUNT_ID,
};
const second: VaccinationHistoryRow = {
    ...first,
    id: SECOND_ID,
    createdAt: '2026-09-26T12:00:00.123455Z',
    nextDueDate: '2027-09-20',
};

function setup(rows: VaccinationHistoryRow[] | null = [first, second]) {
    const findAccessiblePage = jest
        .fn<Promise<VaccinationHistoryRow[] | null>, [VaccinationHistoryReadRequest]>()
        .mockResolvedValue(rows);
    const reader: VaccinationHistoryReader = { findAccessiblePage };

    return { useCase: new ListPetVaccinationHistory(reader), findAccessiblePage };
}

describe('ListPetVaccinationHistory', () => {
    it('returns public fields and cursors from the last returned row', async () => {
        const { useCase, findAccessiblePage } = setup();
        const result = await useCase.execute({
            petId: PET_ID,
            authenticatedAccountId: ACCOUNT_ID,
            limit: 1,
            cursor: null,
        });

        expect(findAccessiblePage.mock.calls[0]?.[0]).toEqual({
            petId: PET_ID,
            accountId: ACCOUNT_ID,
            after: null,
            limit: 2,
        });
        expect(result.items).toEqual([
            {
                id: FIRST_ID,
                vaccineName: 'Rabies',
                appliedDate: '2026-09-20',
                nextDueDate: null,
                recordedByAccountId: ACCOUNT_ID,
            },
        ]);
        expect(decodeVaccinationHistoryCursor(result.nextCursor as string, PET_ID)).toEqual({
            id: FIRST_ID,
            appliedDate: first.appliedDate,
            createdAt: first.createdAt,
        });
    });

    it('passes the decoded position and ends the final page', async () => {
        const { useCase, findAccessiblePage } = setup([second]);
        const cursor: string = encodeVaccinationHistoryCursor(PET_ID, first);
        const result = await useCase.execute({
            petId: PET_ID,
            authenticatedAccountId: ACCOUNT_ID,
            limit: 1,
            cursor,
        });

        expect(findAccessiblePage.mock.calls[0]?.[0].after).toEqual({
            id: FIRST_ID,
            appliedDate: first.appliedDate,
            createdAt: first.createdAt,
        });
        expect(result.items[0]?.nextDueDate).toBe('2027-09-20');
        expect(result.nextCursor).toBeNull();
    });

    it('returns an empty history for an accessible pet', async () => {
        const { useCase } = setup([]);

        await expect(
            useCase.execute({
                petId: PET_ID,
                authenticatedAccountId: ACCOUNT_ID,
                limit: 20,
                cursor: null,
            }),
        ).resolves.toEqual({ items: [], nextCursor: null });
    });

    it('passes the requested limit plus one', async () => {
        const { useCase, findAccessiblePage } = setup([]);

        await useCase.execute({
            petId: PET_ID,
            authenticatedAccountId: ACCOUNT_ID,
            limit: 100,
            cursor: null,
        });
        expect(findAccessiblePage.mock.calls[0]?.[0].limit).toBe(101);
    });

    it('hides inaccessible pets and propagates unexpected failures', async () => {
        const denied = setup(null);

        await expect(
            denied.useCase.execute({
                petId: PET_ID,
                authenticatedAccountId: ACCOUNT_ID,
                limit: 20,
                cursor: null,
            }),
        ).rejects.toThrow(PetNotFoundError);
        const failing = setup();

        failing.findAccessiblePage.mockRejectedValue(new Error('database failure'));
        await expect(
            failing.useCase.execute({
                petId: PET_ID,
                authenticatedAccountId: ACCOUNT_ID,
                limit: 20,
                cursor: null,
            }),
        ).rejects.toThrow('database failure');
    });
});

describe('vaccination history cursor', () => {
    it('preserves a six-digit timestamp and the exact ordering key', () => {
        const cursor: string = encodeVaccinationHistoryCursor(PET_ID, first);

        expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual({
            v: 1,
            petId: PET_ID,
            appliedDate: first.appliedDate,
            createdAt: first.createdAt,
            id: FIRST_ID,
        });
        expect(decodeVaccinationHistoryCursor(cursor, PET_ID)).toEqual({
            appliedDate: first.appliedDate,
            createdAt: first.createdAt,
            id: FIRST_ID,
        });
    });

    it.each([
        '',
        'not-base64!',
        'YQ',
        Buffer.from('not json').toString('base64url'),
        Buffer.from(JSON.stringify({ v: 2, petId: PET_ID, ...first })).toString('base64url'),
        Buffer.from(
            JSON.stringify({
                v: 1,
                petId: PET_ID,
                appliedDate: '2026-02-30',
                createdAt: first.createdAt,
                id: FIRST_ID,
            }),
        ).toString('base64url'),
        Buffer.from(
            JSON.stringify({
                v: 1,
                petId: PET_ID,
                appliedDate: first.appliedDate,
                createdAt: '2026-09-26T12:00:00.123Z',
                id: FIRST_ID,
            }),
        ).toString('base64url'),
        Buffer.from(
            JSON.stringify({
                v: 1,
                petId: PET_ID,
                appliedDate: first.appliedDate,
                createdAt: '2026-09-26T25:00:00.123456Z',
                id: FIRST_ID,
            }),
        ).toString('base64url'),
        Buffer.from(
            JSON.stringify({
                v: 1,
                petId: PET_ID,
                appliedDate: first.appliedDate,
                createdAt: first.createdAt,
                id: FIRST_ID,
                extra: true,
            }),
        ).toString('base64url'),
    ])('rejects malformed cursor %s', (cursor) => {
        expect(() => decodeVaccinationHistoryCursor(cursor, PET_ID)).toThrow(
            InvalidVaccinationHistoryCursorError,
        );
    });

    it('rejects a cursor for another pet', () => {
        const cursor: string = encodeVaccinationHistoryCursor(OTHER_PET_ID, first);

        expect(() => decodeVaccinationHistoryCursor(cursor, PET_ID)).toThrow(
            InvalidVaccinationHistoryCursorError,
        );
    });
});
