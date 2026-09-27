import type {
  WeightHistoryReadRequest,
  WeightHistoryReader,
  WeightHistoryRow,
} from '../persistence/weight-history.reader';
import {
  ListPetWeightHistory,
  PetNotFoundError,
} from './list-pet-weight-history';
import {
  decodeWeightHistoryCursor,
  encodeWeightHistoryCursor,
  InvalidWeightHistoryCursorError,
} from './weight-history-cursor';

const PET_ID = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const OTHER_PET_ID = '4ada58ea-14fc-4642-846b-b2fc8d51e246';
const ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';
const FIRST_ID = '80db31a0-aeb9-4768-b103-770110b39fd8';
const SECOND_ID = '7197fb48-3906-4da9-86d7-8323e04d7725';

const first: WeightHistoryRow = {
  id: FIRST_ID,
  weightKg: '12.34',
  measuredDate: '2026-09-26',
  createdAt: '2026-09-26T12:00:00.123456Z',
  recordedByAccountId: ACCOUNT_ID,
};
const second: WeightHistoryRow = {
  ...first,
  id: SECOND_ID,
  createdAt: '2026-09-26T12:00:00.123455Z',
};

function setup(rows: WeightHistoryRow[] | null = [first, second]) {
  const findAccessiblePage = jest
    .fn<Promise<WeightHistoryRow[] | null>, [WeightHistoryReadRequest]>()
    .mockResolvedValue(rows);
  const reader: WeightHistoryReader = { findAccessiblePage };
  return { useCase: new ListPetWeightHistory(reader), findAccessiblePage };
}

describe('ListPetWeightHistory', () => {
  it('returns only public item fields and a cursor for the final returned row', async () => {
    const { useCase, findAccessiblePage } = setup();
    const result = await useCase.execute({
      petId: PET_ID,
      authenticatedAccountId: ACCOUNT_ID,
      limit: 1,
      cursor: null,
    });
    expect(findAccessiblePage).toHaveBeenCalledWith({
      petId: PET_ID,
      accountId: ACCOUNT_ID,
      after: null,
      limit: 2,
    });
    expect(result.items).toEqual([
      {
        id: FIRST_ID,
        weightKg: '12.34',
        measuredDate: '2026-09-26',
        recordedByAccountId: ACCOUNT_ID,
      },
    ]);
    expect(result.nextCursor).not.toBeNull();
    expect(
      decodeWeightHistoryCursor(result.nextCursor as string, PET_ID),
    ).toEqual({
      id: FIRST_ID,
      measuredDate: first.measuredDate,
      createdAt: first.createdAt,
    });
  });

  it('passes the decoded position to the reader', async () => {
    const { useCase, findAccessiblePage } = setup([second]);
    const cursor: string = encodeWeightHistoryCursor(PET_ID, first);
    const result = await useCase.execute({
      petId: PET_ID,
      authenticatedAccountId: ACCOUNT_ID,
      limit: 1,
      cursor,
    });
    expect(findAccessiblePage).toHaveBeenCalledWith({
      petId: PET_ID,
      accountId: ACCOUNT_ID,
      after: {
        id: FIRST_ID,
        measuredDate: first.measuredDate,
        createdAt: first.createdAt,
      },
      limit: 2,
    });
    expect(result.nextCursor).toBeNull();
  });

  it('returns an empty page with no cursor', async () => {
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

  it.each([
    'inactive owner',
    'inactive collaborator',
    'no membership',
    'missing pet',
  ])('hides %s when the reader denies access', async () => {
    const { useCase } = setup(null);
    await expect(
      useCase.execute({
        petId: PET_ID,
        authenticatedAccountId: ACCOUNT_ID,
        limit: 20,
        cursor: null,
      }),
    ).rejects.toThrow(PetNotFoundError);
  });

  it('propagates unexpected persistence errors', async () => {
    const { useCase, findAccessiblePage } = setup();
    findAccessiblePage.mockRejectedValue(new Error('database failure'));
    await expect(
      useCase.execute({
        petId: PET_ID,
        authenticatedAccountId: ACCOUNT_ID,
        limit: 20,
        cursor: null,
      }),
    ).rejects.toThrow('database failure');
  });
});

describe('weight history cursor', () => {
  it.each([
    '',
    'not-base64!',
    Buffer.from('not json').toString('base64url'),
    Buffer.from(JSON.stringify({ v: 2, petId: PET_ID, ...first })).toString(
      'base64url',
    ),
    Buffer.from(
      JSON.stringify({
        v: 1,
        petId: PET_ID,
        id: FIRST_ID,
        measuredDate: '2026-02-30',
        createdAt: first.createdAt,
      }),
    ).toString('base64url'),
    Buffer.from(
      JSON.stringify({
        v: 1,
        petId: PET_ID,
        id: FIRST_ID,
        measuredDate: first.measuredDate,
        createdAt: '2026-09-26T12:00:00.123Z',
      }),
    ).toString('base64url'),
  ])('rejects invalid cursor %s', (token) => {
    expect(() => decodeWeightHistoryCursor(token, PET_ID)).toThrow(
      InvalidWeightHistoryCursorError,
    );
  });

  it('rejects a cursor from another pet', () => {
    const token: string = encodeWeightHistoryCursor(OTHER_PET_ID, first);
    expect(() => decodeWeightHistoryCursor(token, PET_ID)).toThrow(
      InvalidWeightHistoryCursorError,
    );
  });
});
