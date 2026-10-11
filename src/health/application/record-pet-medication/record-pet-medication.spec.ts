import {
    PetMedication,
    PetId,
    RecordedByAccountId,
    InvalidMedicationNameValueError,
    InvalidMedicationDosageValueError,
    InvalidMedicationFrequencyValueError,
    InvalidMedicationStartDateValueError,
    InvalidMedicationPlannedEndDateValueError,
    InvalidMedicationNotesValueError,
} from '../../domain/pet-medication/pet-medication';
import type { PetMedicationRepository } from '../persistence/pet-medication.repository';
import {
    RecordPetMedication,
    PetNotFoundError,
    type RecordPetMedicationCommand,
    InvalidMedicationNameError,
    InvalidMedicationDosageError,
    InvalidMedicationFrequencyError,
    InvalidMedicationStartDateError,
    InvalidMedicationPlannedEndDateError,
    InvalidMedicationNotesError,
} from './record-pet-medication';

function command(): RecordPetMedicationCommand {
    return {
        petId: 'b30a4c42-84e5-4765-99d4-1efb17f09c12',
        authenticatedAccountId: '550e8400-e29b-41d4-a716-446655440000',
        name: ' Amoxicillin ',
        dosage: ' 250 mg ',
        frequency: ' Every 12 hours ',
        startDate: '2099-10-10',
        plannedEndDate: '2099-10-17',
        notes: ' Give with food ',
    };
}

function setup() {
    const createIfPetWritable = jest.fn<
        ReturnType<PetMedicationRepository['createIfPetWritable']>,
        Parameters<PetMedicationRepository['createIfPetWritable']>
    >();
    const repository: PetMedicationRepository = {
        deleteIfPetWritable: jest.fn(),
        createIfPetWritable,
        correctIfPetWritable: jest.fn(),
    };

    return { useCase: new RecordPetMedication(repository), createIfPetWritable };
}

describe('RecordPetMedication', () => {
    it('delegates the exact raw command and projects the real returned aggregate without Clock', async () => {
        const { useCase, createIfPetWritable } = setup();
        const recording = command();
        const medication: PetMedication = PetMedication.create({
            ...recording,
            petId: PetId.from(recording.petId),
            recordedByAccountId: RecordedByAccountId.from(recording.authenticatedAccountId),
        });

        createIfPetWritable.mockResolvedValue({ status: 'CREATED', medication });
        expect(await useCase.execute(recording)).toEqual({
            id: medication.id.value,
            petId: recording.petId,
            name: 'Amoxicillin',
            dosage: '250 mg',
            frequency: 'Every 12 hours',
            startDate: recording.startDate,
            plannedEndDate: recording.plannedEndDate,
            notes: 'Give with food',
            recordedByAccountId: recording.authenticatedAccountId,
        });
        expect(createIfPetWritable).toHaveBeenCalledTimes(1);
        expect(createIfPetWritable).toHaveBeenCalledWith(recording);
        expect(recording).toEqual(command());
    });

    it('projects absent functional values as explicit null', async () => {
        const { useCase, createIfPetWritable } = setup();
        const recording: RecordPetMedicationCommand = {
            petId: command().petId,
            authenticatedAccountId: command().authenticatedAccountId,
            name: 'Amoxicillin',
        };
        const medication: PetMedication = PetMedication.create({
            name: recording.name,
            petId: PetId.from(recording.petId),
            recordedByAccountId: RecordedByAccountId.from(recording.authenticatedAccountId),
        });

        createIfPetWritable.mockResolvedValue({ status: 'CREATED', medication });
        expect(await useCase.execute(recording)).toEqual({
            id: medication.id.value,
            petId: recording.petId,
            name: 'Amoxicillin',
            dosage: null,
            frequency: null,
            startDate: null,
            plannedEndDate: null,
            notes: null,
            recordedByAccountId: recording.authenticatedAccountId,
        });
    });

    it('maps PET_NOT_FOUND without validating semantic values before persistence', async () => {
        const { useCase, createIfPetWritable } = setup();
        const recording: RecordPetMedicationCommand = {
            ...command(),
            name: '',
            startDate: 'bad',
            notes: '',
        };

        createIfPetWritable.mockResolvedValue({ status: 'PET_NOT_FOUND' });
        await expect(useCase.execute(recording)).rejects.toThrow(PetNotFoundError);
        expect(createIfPetWritable).toHaveBeenCalledWith(recording);
    });

    it.each([
        [InvalidMedicationNameValueError, InvalidMedicationNameError],
        [InvalidMedicationDosageValueError, InvalidMedicationDosageError],
        [InvalidMedicationFrequencyValueError, InvalidMedicationFrequencyError],
        [InvalidMedicationStartDateValueError, InvalidMedicationStartDateError],
        [InvalidMedicationPlannedEndDateValueError, InvalidMedicationPlannedEndDateError],
        [InvalidMedicationNotesValueError, InvalidMedicationNotesError],
    ])(
        'maps specific domain errors after repository authorization',
        async (DomainError, ApplicationError) => {
            const { useCase, createIfPetWritable } = setup();
            const cause = new DomainError(new TypeError('Invalid medication information'));

            createIfPetWritable.mockRejectedValue(cause);
            await expect(useCase.execute(command())).rejects.toThrow(ApplicationError);
            await expect(useCase.execute(command())).rejects.toMatchObject({
                cause,
                message: cause.message,
            });
        },
    );

    it.each([new Error('Database unavailable'), new TypeError('Unexpected failure')])(
        'propagates unexpected failures unchanged',
        async (failure: Error) => {
            const { useCase, createIfPetWritable } = setup();

            createIfPetWritable.mockRejectedValue(failure);
            await expect(useCase.execute(command())).rejects.toBe(failure);
        },
    );
});
