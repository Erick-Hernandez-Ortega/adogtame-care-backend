import type { VaccinationRecordRepository } from '../persistence/vaccination-record.repository';
import { PetNotFoundError } from '../record-vaccination/record-vaccination';
import { VaccinationRecordNotFoundError } from '../update-vaccination-record/update-vaccination-record';
import { DeleteVaccinationRecord } from './delete-vaccination-record';

const access = {
  petId: 'b30a4c42-84e5-4765-99d4-1efb17f09c12',
  vaccinationRecordId: '6fe44a29-206e-4875-9f3e-72026868135e',
  authenticatedAccountId: '550e8400-e29b-41d4-a716-446655440000',
};

function setup() {
  const deleteIfPetWritable = jest
    .fn<
      ReturnType<VaccinationRecordRepository['deleteIfPetWritable']>,
      Parameters<VaccinationRecordRepository['deleteIfPetWritable']>
    >()
    .mockResolvedValue('DELETED');
  const repository: VaccinationRecordRepository = {
    createIfPetWritable: jest.fn(),
    correctIfPetWritable: jest.fn(),
    deleteIfPetWritable,
  };
  return {
    useCase: new DeleteVaccinationRecord(repository),
    deleteIfPetWritable,
  };
}

describe('DeleteVaccinationRecord', () => {
  it('deletes an accessible record', async () => {
    const { useCase, deleteIfPetWritable } = setup();
    await expect(useCase.execute(access)).resolves.toBeUndefined();
    expect(deleteIfPetWritable).toHaveBeenCalledWith(access);
  });

  it('maps missing pet and record outcomes', async () => {
    const missingPet = setup();
    missingPet.deleteIfPetWritable.mockResolvedValue('PET_NOT_FOUND');
    await expect(missingPet.useCase.execute(access)).rejects.toThrow(
      PetNotFoundError,
    );
    const missingRecord = setup();
    missingRecord.deleteIfPetWritable.mockResolvedValue(
      'VACCINATION_RECORD_NOT_FOUND',
    );
    await expect(missingRecord.useCase.execute(access)).rejects.toThrow(
      VaccinationRecordNotFoundError,
    );
  });

  it('propagates an unexpected persistence failure', async () => {
    const { useCase, deleteIfPetWritable } = setup();
    deleteIfPetWritable.mockRejectedValue(new Error('database failure'));
    await expect(useCase.execute(access)).rejects.toThrow('database failure');
  });
});
