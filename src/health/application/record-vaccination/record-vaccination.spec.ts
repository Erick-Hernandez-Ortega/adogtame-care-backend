import type { VaccinationRecordRepository } from '../persistence/vaccination-record.repository';
import type { Clock } from '../time/clock';
import {
  InvalidAppliedDateError,
  InvalidNextDueDateError,
  InvalidVaccineNameError,
  PetNotFoundError,
  RecordVaccination,
  type RecordVaccinationCommand,
} from './record-vaccination';

const petId = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const authenticatedAccountId = '550e8400-e29b-41d4-a716-446655440000';

function command(
  overrides: Partial<RecordVaccinationCommand> = {},
): RecordVaccinationCommand {
  return {
    petId,
    vaccineName: '  Rabies  ',
    appliedDate: '2026-09-26',
    nextDueDate: '2027-09-26',
    authenticatedAccountId,
    ...overrides,
  };
}

function setup(outcome: 'CREATED' | 'PET_NOT_FOUND' = 'CREATED') {
  const createIfPetWritable = jest
    .fn<
      ReturnType<VaccinationRecordRepository['createIfPetWritable']>,
      Parameters<VaccinationRecordRepository['createIfPetWritable']>
    >()
    .mockResolvedValue(outcome);
  const repository: VaccinationRecordRepository = { createIfPetWritable };
  const now = jest.fn((): Date => new Date('2026-09-26T00:30:00.000Z'));
  const clock: Clock = { now };
  return {
    useCase: new RecordVaccination(repository, clock),
    createIfPetWritable,
    now,
  };
}

describe('RecordVaccination', () => {
  it.each([
    ['2027-09-26', '2027-09-26'],
    [null, null],
  ] as const)(
    'records normalized name with next due date %s',
    async (nextDueDate, expected) => {
      const { useCase, createIfPetWritable, now } = setup();
      const result = await useCase.execute(command({ nextDueDate }));
      expect(result).toMatchObject({
        petId,
        vaccineName: 'Rabies',
        appliedDate: '2026-09-26',
        nextDueDate: expected,
        recordedByAccountId: authenticatedAccountId,
      });
      expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(createIfPetWritable.mock.calls[0]?.[1]).toBe(
        authenticatedAccountId,
      );
      expect(
        createIfPetWritable.mock.calls[0]?.[0].recordedByAccountId.value,
      ).toBe(authenticatedAccountId);
      expect(now).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [command({ vaccineName: ' ' }), InvalidVaccineNameError],
    [command({ vaccineName: 'x'.repeat(256) }), InvalidVaccineNameError],
    [command({ appliedDate: '2026-09-27' }), InvalidAppliedDateError],
    [command({ appliedDate: '2026-02-29' }), InvalidAppliedDateError],
    [command({ nextDueDate: '2026-09-26' }), InvalidNextDueDateError],
    [command({ nextDueDate: '2026-09-25' }), InvalidNextDueDateError],
    [command({ nextDueDate: '2027-02-29' }), InvalidNextDueDateError],
  ])(
    'rejects invalid domain input before persistence',
    async (input, errorClass) => {
      const { useCase, createIfPetWritable } = setup();
      await expect(useCase.execute(input)).rejects.toThrow(errorClass);
      expect(createIfPetWritable.mock.calls).toHaveLength(0);
    },
  );

  it('validates name before the dates', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(
        command({
          vaccineName: '',
          appliedDate: '9999-12-31',
          nextDueDate: 'x',
        }),
      ),
    ).rejects.toThrow(InvalidVaccineNameError);
  });

  it('accepts an overdue next dose in historical data', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(
        command({ appliedDate: '2024-01-10', nextDueDate: '2025-01-10' }),
      ),
    ).resolves.toMatchObject({ nextDueDate: '2025-01-10' });
  });

  it('hides inaccessible pets and propagates unexpected persistence errors', async () => {
    const missing = setup('PET_NOT_FOUND');
    await expect(missing.useCase.execute(command())).rejects.toThrow(
      PetNotFoundError,
    );
    const failing = setup();
    failing.createIfPetWritable.mockRejectedValue(
      new Error('database failure'),
    );
    await expect(failing.useCase.execute(command())).rejects.toThrow(
      'database failure',
    );
  });
});
