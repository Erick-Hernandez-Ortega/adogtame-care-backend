import { MeasuredDate } from '../../domain/measured-date/measured-date';
import {
  PetId,
  RecordedByAccountId,
  WeightRecord,
  WeightRecordId,
} from '../../domain/weight-record/weight-record';
import { Weight } from '../../domain/weight/weight';
import type { WeightRecordRepository } from '../persistence/weight-record.repository';
import {
  InvalidMeasuredDateError,
  InvalidWeightError,
  PetNotFoundError,
} from '../record-pet-weight/record-pet-weight';
import { DeletePetWeightRecord } from '../delete-pet-weight-record/delete-pet-weight-record';
import {
  UpdatePetWeightRecord,
  WeightRecordNotFoundError,
} from './update-pet-weight-record';

const petId = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const weightRecordId = '68f9d91f-cbcd-4da7-b1b8-1ee61a0bb321';
const authenticatedAccountId = '550e8400-e29b-41d4-a716-446655440000';
const command = { petId, weightRecordId, authenticatedAccountId };
const record = WeightRecord.reconstitute({
  id: WeightRecordId.from(weightRecordId),
  petId: PetId.from(petId),
  weight: Weight.fromKilograms('12'),
  measuredDate: MeasuredDate.from('2026-09-25', '2026-09-26'),
  recordedByAccountId: RecordedByAccountId.from(authenticatedAccountId),
});

function setup(): {
  repository: jest.Mocked<WeightRecordRepository>;
  update: UpdatePetWeightRecord;
  deletion: DeletePetWeightRecord;
} {
  const repository: jest.Mocked<WeightRecordRepository> = {
    createIfPetWritable: jest.fn(),
    correctIfPetWritable: jest
      .fn()
      .mockResolvedValue({ status: 'UPDATED', record }),
    deleteIfPetWritable: jest.fn().mockResolvedValue('DELETED'),
  };
  return {
    repository,
    update: new UpdatePetWeightRecord(repository, {
      now: (): Date => new Date('2026-09-26T00:30:00Z'),
    }),
    deletion: new DeletePetWeightRecord(repository),
  };
}

describe('ManagePetWeightRecord', () => {
  it.each(['UPDATED', 'UNCHANGED'] as const)(
    'returns the record for %s',
    async (status) => {
      const { repository, update } = setup();
      repository.correctIfPetWritable.mockResolvedValue({ status, record });
      await expect(
        update.execute({ ...command, weightKg: '012.3400' }),
      ).resolves.toEqual({
        id: weightRecordId,
        petId,
        weightKg: '12',
        measuredDate: '2026-09-25',
        recordedByAccountId: authenticatedAccountId,
      });
      expect(repository.correctIfPetWritable.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          weight: expect.objectContaining({ kilograms: '12.34' }) as object,
          measuredDate: undefined,
        }),
      );
    },
  );

  it('validates weight before date and before persistence', async () => {
    const { repository, update } = setup();
    await expect(
      update.execute({ ...command, weightKg: '0', measuredDate: '9999-12-31' }),
    ).rejects.toThrow(InvalidWeightError);
    await expect(
      update.execute({ ...command, measuredDate: '2026-09-27' }),
    ).rejects.toThrow(InvalidMeasuredDateError);
    expect(repository.correctIfPetWritable.mock.calls).toHaveLength(0);
  });

  it.each([
    ['PET_NOT_FOUND', PetNotFoundError],
    ['WEIGHT_RECORD_NOT_FOUND', WeightRecordNotFoundError],
  ] as const)('maps update %s', async (status, errorClass) => {
    const { repository, update } = setup();
    repository.correctIfPetWritable.mockResolvedValue({ status });
    await expect(
      update.execute({ ...command, measuredDate: '2026-09-26' }),
    ).rejects.toThrow(errorClass);
  });

  it.each([
    ['PET_NOT_FOUND', PetNotFoundError],
    ['WEIGHT_RECORD_NOT_FOUND', WeightRecordNotFoundError],
  ] as const)('maps delete %s', async (status, errorClass) => {
    const { repository, deletion } = setup();
    repository.deleteIfPetWritable.mockResolvedValue(status);
    await expect(deletion.execute(command)).rejects.toThrow(errorClass);
  });

  it('deletes and propagates persistence failures', async () => {
    const { repository, update, deletion } = setup();
    await expect(deletion.execute(command)).resolves.toBeUndefined();
    repository.correctIfPetWritable.mockRejectedValue(
      new Error('database failure'),
    );
    await expect(update.execute({ ...command, weightKg: '1' })).rejects.toThrow(
      'database failure',
    );
    repository.deleteIfPetWritable.mockRejectedValue(
      new Error('database failure'),
    );
    await expect(deletion.execute(command)).rejects.toThrow('database failure');
  });
});
