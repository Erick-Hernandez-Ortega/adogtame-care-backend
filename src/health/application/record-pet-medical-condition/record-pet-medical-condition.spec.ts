import type { PetMedicalConditionRepository } from '../persistence/pet-medical-condition.repository';
import type { Clock } from '../time/clock';
import {
    InvalidMedicalConditionNameError,
    InvalidMedicalConditionDiagnosedDateError,
    InvalidMedicalConditionNotesError,
    PetNotFoundError,
    RecordPetMedicalCondition,
    type RecordPetMedicalConditionCommand,
} from './record-pet-medical-condition';

function command(
    overrides: Partial<RecordPetMedicalConditionCommand> = {},
): RecordPetMedicalConditionCommand {
    return {
        petId: 'b30a4c42-84e5-4765-99d4-1efb17f09c12',
        authenticatedAccountId: '550e8400-e29b-41d4-a716-446655440000',
        name: '  Epilepsy  ',
        diagnosedDate: '2026-03-14',
        notes: '  Recurring seizures.  ',
        ...overrides,
    };
}

function setup() {
    const createIfPetWritable = jest
        .fn<
            ReturnType<PetMedicalConditionRepository['createIfPetWritable']>,
            Parameters<PetMedicalConditionRepository['createIfPetWritable']>
        >()
        .mockResolvedValue('CREATED');
    const repository: PetMedicalConditionRepository = {
        createIfPetWritable,
        correctIfPetWritable: jest.fn(),
    };
    const now = jest.fn((): Date => new Date('2026-03-13T18:30:00-06:00'));
    const clock: Clock = { now };

    return {
        useCase: new RecordPetMedicalCondition(repository, clock),
        createIfPetWritable,
        now,
    };
}

describe('RecordPetMedicalCondition', () => {
    it('persists a real ACTIVE aggregate with requester separate from author and returns exact information', async () => {
        const { useCase, createIfPetWritable, now } = setup();
        const result = await useCase.execute(command());
        const condition = createIfPetWritable.mock.calls[0]?.[0];

        expect(result).toEqual({
            id: condition?.id.value,
            petId: command().petId,
            name: 'Epilepsy',
            status: 'ACTIVE',
            diagnosedDate: '2026-03-14',
            notes: 'Recurring seizures.',
            recordedByAccountId: command().authenticatedAccountId,
        });
        expect(createIfPetWritable.mock.calls[0]?.[1]).toBe(command().authenticatedAccountId);
        expect(condition?.recordedByAccountId.value).toBe(command().authenticatedAccountId);
        expect(now).toHaveBeenCalledTimes(1);
    });
    it.each([undefined, null])(
        'does not consult Clock for an unknown date %s',
        async (value: undefined | null) => {
            const { useCase, now } = setup();

            expect(
                await useCase.execute(command({ diagnosedDate: value, notes: value })),
            ).toMatchObject({ diagnosedDate: null, notes: null });
            expect(now).not.toHaveBeenCalled();
        },
    );
    it.each([
        [command({ name: ' ' }), InvalidMedicalConditionNameError],
        [command({ name: '🐕'.repeat(256) }), InvalidMedicalConditionNameError],
        [command({ diagnosedDate: '2026-03-15' }), InvalidMedicalConditionDiagnosedDateError],
        [command({ diagnosedDate: '2026-02-29' }), InvalidMedicalConditionDiagnosedDateError],
        [command({ diagnosedDate: '2026' }), InvalidMedicalConditionDiagnosedDateError],
        [command({ notes: ' ' }), InvalidMedicalConditionNotesError],
        [command({ notes: '🐕'.repeat(2001) }), InvalidMedicalConditionNotesError],
    ])('maps domain errors before persistence', async (input, errorClass) => {
        const { useCase, createIfPetWritable } = setup();

        await expect(useCase.execute(input)).rejects.toThrow(errorClass);
        expect(createIfPetWritable).not.toHaveBeenCalled();
    });
    it('validates name before date and date before notes', async () => {
        const { useCase } = setup();

        await expect(
            useCase.execute(command({ name: '', diagnosedDate: 'x', notes: '' })),
        ).rejects.toThrow(InvalidMedicalConditionNameError);
        await expect(useCase.execute(command({ diagnosedDate: 'x', notes: '' }))).rejects.toThrow(
            InvalidMedicalConditionDiagnosedDateError,
        );
    });
    it('maps inaccessible pets and propagates repository failures unchanged', async () => {
        const { useCase, createIfPetWritable } = setup();

        createIfPetWritable.mockResolvedValueOnce('PET_NOT_FOUND');
        await expect(useCase.execute(command())).rejects.toThrow(PetNotFoundError);
        const failure: Error = new Error('Database failure');

        createIfPetWritable.mockRejectedValueOnce(failure);
        await expect(useCase.execute(command())).rejects.toBe(failure);
    });
    it('propagates unexpected Clock failures unchanged', async () => {
        const { useCase, createIfPetWritable, now } = setup();
        const failure: Error = new Error('Clock failure');

        now.mockImplementationOnce((): Date => {
            throw failure;
        });
        await expect(useCase.execute(command())).rejects.toBe(failure);
        expect(createIfPetWritable).not.toHaveBeenCalled();
    });
});
