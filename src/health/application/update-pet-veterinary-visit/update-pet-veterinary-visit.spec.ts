import { VisitDate } from '../../domain/visit-date/visit-date';
import { VeterinaryVisitReason } from '../../domain/veterinary-visit-reason/veterinary-visit-reason';
import {
    PetVeterinaryVisit,
    PetVeterinaryVisitId,
    PetId,
    RecordedByAccountId,
} from '../../domain/pet-veterinary-visit/pet-veterinary-visit';
import type { PetVeterinaryVisitRepository } from '../persistence/pet-veterinary-visit.repository';
import {
    InvalidVeterinaryVisitReasonError,
    InvalidVeterinaryVisitDateError,
    InvalidVeterinaryVisitObservationsError,
    InvalidVeterinaryVisitDiagnosisError,
    PetNotFoundError,
} from '../record-pet-veterinary-visit/record-pet-veterinary-visit';
import {
    UpdatePetVeterinaryVisit,
    PetVeterinaryVisitNotFoundError,
    type UpdatePetVeterinaryVisitCommand,
} from './update-pet-veterinary-visit';

const command: UpdatePetVeterinaryVisitCommand = {
    petId: '550e8400-e29b-41d4-a716-446655440001',
    visitId: '550e8400-e29b-41d4-a716-446655440002',
    authenticatedAccountId: '550e8400-e29b-41d4-a716-446655440003',
    reason: ' Osteoarthritis ',
};

function setup() {
    const visit: PetVeterinaryVisit = PetVeterinaryVisit.reconstitute({
        id: PetVeterinaryVisitId.from(command.visitId),
        petId: PetId.from(command.petId),
        reason: VeterinaryVisitReason.from('Arthritis'),
        visitDate: VisitDate.reconstitute('2026-02-10'),
        recordedByAccountId: RecordedByAccountId.from('550e8400-e29b-41d4-a716-446655440004'),
    });
    const correctIfPetWritable = jest
        .fn<
            ReturnType<PetVeterinaryVisitRepository['correctIfPetWritable']>,
            Parameters<PetVeterinaryVisitRepository['correctIfPetWritable']>
        >()
        .mockImplementation(
            (correction): ReturnType<PetVeterinaryVisitRepository['correctIfPetWritable']> => {
                const corrected: PetVeterinaryVisit = visit.correct(
                    correction,
                    correction.getToday(),
                );

                return Promise.resolve({
                    status: corrected === visit ? 'UNCHANGED' : 'UPDATED',
                    visit: corrected,
                });
            },
        );
    const repository: PetVeterinaryVisitRepository = {
        createIfPetWritable: jest.fn(),
        correctIfPetWritable,
    };
    const now = jest.fn((): Date => new Date('2026-03-13T18:30:00-06:00'));

    return {
        useCase: new UpdatePetVeterinaryVisit(repository, { now }),
        correctIfPetWritable,
        now,
        visit,
    };
}

describe('UpdatePetVeterinaryVisit', () => {
    it('returns complete UPDATED information preserving another author', async () => {
        const { useCase, now, visit } = setup();

        expect(await useCase.execute(command)).toEqual({
            id: command.visitId,
            petId: command.petId,
            reason: 'Osteoarthritis',
            visitDate: '2026-02-10',
            diagnosis: null,
            observations: null,
            recordedByAccountId: visit.recordedByAccountId.value,
        });
        expect(now).toHaveBeenCalledTimes(1);
    });
    it('returns UNCHANGED and passes raw values and deferred UTC Clock to persistence', async () => {
        const { useCase, correctIfPetWritable, now } = setup();

        expect(await useCase.execute({ ...command, reason: ' Arthritis ' })).toMatchObject({
            reason: 'Arthritis',
        });
        expect(correctIfPetWritable.mock.calls[0]?.[0]).toMatchObject({
            reason: ' Arthritis ',
            authenticatedAccountId: command.authenticatedAccountId,
        });
        expect(now).toHaveBeenCalledTimes(1);
        correctIfPetWritable.mockImplementationOnce(
            (correction): ReturnType<PetVeterinaryVisitRepository['correctIfPetWritable']> => {
                expect(now).toHaveBeenCalledTimes(1);
                expect(correction.getToday()).toBe('2026-03-14');

                return Promise.resolve({ status: 'PET_NOT_FOUND' });
            },
        );
        await expect(useCase.execute(command)).rejects.toThrow(PetNotFoundError);
    });
    it.each([
        ['PET_NOT_FOUND', PetNotFoundError],
        ['PET_VETERINARY_VISIT_NOT_FOUND', PetVeterinaryVisitNotFoundError],
    ] as const)(
        'maps %s without consulting Clock or validating the patch',
        async (status, errorClass) => {
            const { useCase, correctIfPetWritable, now } = setup();

            correctIfPetWritable.mockResolvedValueOnce({ status });
            await expect(useCase.execute({ ...command, reason: '' })).rejects.toThrow(errorClass);
            expect(now).not.toHaveBeenCalled();
        },
    );
    it.each([
        [{ reason: '' }, InvalidVeterinaryVisitReasonError],
        [{ visitDate: '2026-03-15' }, InvalidVeterinaryVisitDateError],
        [{ observations: ' ' }, InvalidVeterinaryVisitObservationsError],
        [{ diagnosis: ' ' }, InvalidVeterinaryVisitDiagnosisError],
    ])('maps Domain errors for %j', async (patch, errorClass) => {
        await expect(setup().useCase.execute({ ...command, ...patch })).rejects.toThrow(errorClass);
    });
    it('propagates unexpected repository and Clock failures', async () => {
        const { useCase, correctIfPetWritable, now } = setup();
        const failure: Error = new Error('Unexpected failure');

        correctIfPetWritable.mockRejectedValueOnce(failure);
        await expect(useCase.execute(command)).rejects.toBe(failure);
        now.mockImplementationOnce((): Date => {
            throw failure;
        });
        await expect(useCase.execute(command)).rejects.toBe(failure);
    });
});
