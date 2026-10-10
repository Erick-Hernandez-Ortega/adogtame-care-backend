import { PetMedicalConditionNotFoundError } from '../update-pet-medical-condition/update-pet-medical-condition';
import { InvalidMedicalConditionResolvedDateError } from './resolve-pet-medical-condition';
import { MedicalConditionName } from '../../domain/medical-condition-name/medical-condition-name';
import {
    PetMedicalCondition,
    PetMedicalConditionId,
    PetId,
    RecordedByAccountId,
} from '../../domain/pet-medical-condition/pet-medical-condition';
import type { PetMedicalConditionRepository } from '../persistence/pet-medical-condition.repository';
import { PetNotFoundError } from '../record-pet-medical-condition/record-pet-medical-condition';
import {
    ResolvePetMedicalCondition,
    type ResolvePetMedicalConditionCommand,
} from './resolve-pet-medical-condition';

const command: ResolvePetMedicalConditionCommand = {
    petId: '550e8400-e29b-41d4-a716-446655440001',
    conditionId: '550e8400-e29b-41d4-a716-446655440002',
    authenticatedAccountId: '550e8400-e29b-41d4-a716-446655440003',
    resolvedDate: '2026-03-14',
};

function setup(status: string = 'ACTIVE') {
    const condition: PetMedicalCondition = PetMedicalCondition.reconstitute({
        id: PetMedicalConditionId.from(command.conditionId),
        petId: PetId.from(command.petId),
        name: MedicalConditionName.from('Arthritis'),
        status,
        recordedByAccountId: RecordedByAccountId.from('550e8400-e29b-41d4-a716-446655440004'),
    });
    const resolveIfPetWritable = jest
        .fn<
            ReturnType<PetMedicalConditionRepository['resolveIfPetWritable']>,
            Parameters<PetMedicalConditionRepository['resolveIfPetWritable']>
        >()
        .mockImplementation(
            (resolution): ReturnType<PetMedicalConditionRepository['resolveIfPetWritable']> => {
                const resolved: PetMedicalCondition = condition.resolve(
                    resolution,
                    resolution.getToday(),
                );

                return Promise.resolve({
                    status: resolved === condition ? 'UNCHANGED' : 'RESOLVED',
                    condition: resolved,
                });
            },
        );
    const repository: PetMedicalConditionRepository = {
        createIfPetWritable: jest.fn(),
        correctIfPetWritable: jest.fn(),
        resolveIfPetWritable,
    };
    const now = jest.fn((): Date => new Date('2026-03-13T18:30:00-06:00'));

    return {
        useCase: new ResolvePetMedicalCondition(repository, { now }),
        resolveIfPetWritable,
        now,
        condition,
    };
}

describe('ResolvePetMedicalCondition', () => {
    it.each(['ACTIVE', 'RESOLVED'])(
        'returns complete resolved condition from %s',
        async (status) => {
            const { useCase, now, condition } = setup(status);

            expect(await useCase.execute(command)).toEqual({
                id: command.conditionId,
                petId: command.petId,
                name: 'Arthritis',
                status: 'RESOLVED',
                diagnosedDate: null,
                resolvedDate: status === 'ACTIVE' ? '2026-03-14' : null,
                notes: null,
                recordedByAccountId: condition.recordedByAccountId.value,
            });
            expect(now).toHaveBeenCalledTimes(1);
        },
    );

    it('defers UTC clock until repository requests it', async () => {
        const { useCase, resolveIfPetWritable, now } = setup();

        resolveIfPetWritable.mockImplementationOnce((resolution) => {
            expect(now).not.toHaveBeenCalled();
            expect(resolution.resolvedDate).toBe('2026-03-14');
            expect(resolution.getToday()).toBe('2026-03-14');

            return Promise.resolve({ status: 'PET_NOT_FOUND' });
        });
        await expect(useCase.execute(command)).rejects.toThrow(PetNotFoundError);
        expect(now).toHaveBeenCalledTimes(1);
    });
    it.each([
        ['PET_NOT_FOUND', PetNotFoundError],
        ['PET_MEDICAL_CONDITION_NOT_FOUND', PetMedicalConditionNotFoundError],
    ] as const)(
        'maps %s without consulting Clock or validating the patch',
        async (status, errorClass) => {
            const { useCase, resolveIfPetWritable, now } = setup();

            resolveIfPetWritable.mockResolvedValueOnce({ status });
            await expect(useCase.execute({ ...command, resolvedDate: 'invalid' })).rejects.toThrow(
                errorClass,
            );
            expect(now).not.toHaveBeenCalled();
        },
    );
    it.each(['invalid', '2026-02-29', '2026-03-15'])('maps date error %s', async (resolvedDate) => {
        await expect(setup().useCase.execute({ ...command, resolvedDate })).rejects.toThrow(
            InvalidMedicalConditionResolvedDateError,
        );
    });
    it('propagates unexpected repository and Clock failures', async () => {
        const { useCase, resolveIfPetWritable, now } = setup();
        const failure: Error = new Error('Unexpected failure');

        resolveIfPetWritable.mockRejectedValueOnce(failure);
        await expect(useCase.execute(command)).rejects.toBe(failure);
        now.mockImplementationOnce((): Date => {
            throw failure;
        });
        await expect(useCase.execute(command)).rejects.toBe(failure);
    });
});
