import type { PetVeterinaryVisitRepository } from '../persistence/pet-veterinary-visit.repository';
import type { Clock } from '../time/clock';
import {
    InvalidVeterinaryVisitReasonError,
    InvalidVeterinaryVisitDateError,
    InvalidVeterinaryVisitObservationsError,
    InvalidVeterinaryVisitDiagnosisError,
    PetNotFoundError,
    RecordPetVeterinaryVisit,
    type RecordPetVeterinaryVisitCommand,
} from './record-pet-veterinary-visit';

function command(
    overrides: Partial<RecordPetVeterinaryVisitCommand> = {},
): RecordPetVeterinaryVisitCommand {
    return {
        petId: 'b30a4c42-84e5-4765-99d4-1efb17f09c12',
        authenticatedAccountId: '550e8400-e29b-41d4-a716-446655440000',
        reason: '  Epilepsy  ',
        visitDate: '2026-03-14',
        observations: '  Recurring seizures.  ',
        ...overrides,
    };
}

function setup() {
    const createIfPetWritable = jest
        .fn<
            ReturnType<PetVeterinaryVisitRepository['createIfPetWritable']>,
            Parameters<PetVeterinaryVisitRepository['createIfPetWritable']>
        >()
        .mockResolvedValue('CREATED');
    const repository: PetVeterinaryVisitRepository = {
        createIfPetWritable,
    };
    const now = jest.fn((): Date => new Date('2026-03-13T18:30:00-06:00'));
    const clock: Clock = { now };

    return {
        useCase: new RecordPetVeterinaryVisit(repository, clock),
        createIfPetWritable,
        now,
    };
}

describe('RecordPetVeterinaryVisit', () => {
    it('persists a real aggregate with requester separate from author and returns exact information', async () => {
        const { useCase, createIfPetWritable, now } = setup();
        const result = await useCase.execute(command());
        const visit = createIfPetWritable.mock.calls[0]?.[0];

        expect(result).toEqual({
            id: visit?.id.value,
            petId: command().petId,
            reason: 'Epilepsy',
            visitDate: '2026-03-14',
            diagnosis: null,
            observations: 'Recurring seizures.',
            recordedByAccountId: command().authenticatedAccountId,
        });
        expect(createIfPetWritable.mock.calls[0]?.[1]).toBe(command().authenticatedAccountId);
        expect(visit?.recordedByAccountId.value).toBe(command().authenticatedAccountId);
        expect(now).toHaveBeenCalledTimes(1);
    });
    it.each([undefined, null])(
        'normalizes absent optional text %s',
        async (value: undefined | null) => {
            const { useCase } = setup();

            expect(
                await useCase.execute(command({ diagnosis: value, observations: value })),
            ).toMatchObject({ diagnosis: null, observations: null });
        },
    );
    it.each([
        [command({ reason: ' ' }), InvalidVeterinaryVisitReasonError],
        [command({ reason: '🐕'.repeat(256) }), InvalidVeterinaryVisitReasonError],
        [command({ visitDate: '2026-03-15' }), InvalidVeterinaryVisitDateError],
        [command({ visitDate: '2026-02-29' }), InvalidVeterinaryVisitDateError],
        [command({ visitDate: '2026' }), InvalidVeterinaryVisitDateError],
        [command({ diagnosis: ' ' }), InvalidVeterinaryVisitDiagnosisError],
        [command({ diagnosis: '🐕'.repeat(2001) }), InvalidVeterinaryVisitDiagnosisError],
        [command({ observations: ' ' }), InvalidVeterinaryVisitObservationsError],
        [command({ observations: '🐕'.repeat(5001) }), InvalidVeterinaryVisitObservationsError],
    ])('maps domain errors before persistence', async (input, errorClass) => {
        const { useCase, createIfPetWritable } = setup();

        await expect(useCase.execute(input)).rejects.toThrow(errorClass);
        expect(createIfPetWritable).not.toHaveBeenCalled();
    });
    it('validates reason before date and date before observations', async () => {
        const { useCase } = setup();

        await expect(
            useCase.execute(command({ reason: '', visitDate: 'x', observations: '' })),
        ).rejects.toThrow(InvalidVeterinaryVisitReasonError);
        await expect(
            useCase.execute(command({ visitDate: 'x', observations: '' })),
        ).rejects.toThrow(InvalidVeterinaryVisitDateError);
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
