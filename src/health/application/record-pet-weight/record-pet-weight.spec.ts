import type {
  CreateWeightRecordOutcome,
  WeightRecordRepository,
} from '../persistence/weight-record.repository';
import type { Clock } from '../time/clock';
import {
  InvalidMeasuredDateError,
  InvalidWeightError,
  PetNotFoundError,
  RecordPetWeight,
  type RecordPetWeightCommand,
} from './record-pet-weight';

const PET_ID = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';

function command(
  overrides: Partial<RecordPetWeightCommand> = {},
): RecordPetWeightCommand {
  return {
    petId: PET_ID,
    weightKg: '012.3400',
    measuredDate: '2026-09-26',
    authenticatedAccountId: ACCOUNT_ID,
    ...overrides,
  };
}

function setup(outcome: CreateWeightRecordOutcome = 'CREATED') {
  const createIfPetWritable = jest
    .fn<
      Promise<CreateWeightRecordOutcome>,
      [Parameters<WeightRecordRepository['createIfPetWritable']>[0]]
    >()
    .mockResolvedValue(outcome);
  const repository: WeightRecordRepository = { createIfPetWritable };
  const clock: Clock = {
    now: (): Date => new Date('2026-09-26T23:59:59.000Z'),
  };
  return {
    useCase: new RecordPetWeight(repository, clock),
    createIfPetWritable,
  };
}

describe('RecordPetWeight', () => {
  it('records exact canonical kg, UTC measured date, and authenticated account', async () => {
    const { useCase, createIfPetWritable } = setup();
    const result = await useCase.execute(command());
    expect(result).toMatchObject({
      petId: PET_ID,
      weightKg: '12.34',
      measuredDate: '2026-09-26',
      recordedByAccountId: ACCOUNT_ID,
    });
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(createIfPetWritable).toHaveBeenCalledWith(
      expect.objectContaining({
        petId: expect.objectContaining({ value: PET_ID }) as object,
        recordedByAccountId: expect.objectContaining({
          value: ACCOUNT_ID,
        }) as object,
      }),
    );
  });

  it.each([
    ['0', InvalidWeightError],
    ['12.34567', InvalidWeightError],
  ])(
    'rejects invalid weight %s before persistence',
    async (weightKg, errorClass) => {
      const { useCase, createIfPetWritable } = setup();
      await expect(useCase.execute(command({ weightKg }))).rejects.toThrow(
        errorClass,
      );
      expect(createIfPetWritable).not.toHaveBeenCalled();
    },
  );

  it.each(['2026-02-29', '2026-09-27'])(
    'rejects invalid or future measured date %s',
    async (measuredDate) => {
      const { useCase, createIfPetWritable } = setup();
      await expect(useCase.execute(command({ measuredDate }))).rejects.toThrow(
        InvalidMeasuredDateError,
      );
      expect(createIfPetWritable).not.toHaveBeenCalled();
    },
  );

  it('uses UTC today even when local date could differ', async () => {
    const repository: WeightRecordRepository = {
      createIfPetWritable: jest
        .fn()
        .mockResolvedValue(
          'CREATED',
        ) as WeightRecordRepository['createIfPetWritable'],
    };
    const clock: Clock = {
      now: (): Date => new Date('2026-09-26T00:30:00.000Z'),
    };
    await expect(
      new RecordPetWeight(repository, clock).execute(
        command({ measuredDate: '2026-09-27' }),
      ),
    ).rejects.toThrow(InvalidMeasuredDateError);
  });

  it.each([
    'missing pet',
    'archived pet',
    'inactive owner',
    'inactive collaborator',
    'no membership',
  ])('hides %s as PET_NOT_FOUND', async () => {
    const { useCase } = setup('PET_NOT_FOUND');
    await expect(useCase.execute(command())).rejects.toThrow(PetNotFoundError);
  });

  it('propagates unexpected persistence errors', async () => {
    const { useCase, createIfPetWritable } = setup();
    createIfPetWritable.mockRejectedValue(new Error('database failure'));
    await expect(useCase.execute(command())).rejects.toThrow(
      'database failure',
    );
  });
});
