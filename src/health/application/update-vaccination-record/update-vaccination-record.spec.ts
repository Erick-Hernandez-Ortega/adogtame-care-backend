import { AppliedDate } from '../../domain/applied-date/applied-date';
import { NextDueDate } from '../../domain/next-due-date/next-due-date';
import {
    PetId,
    RecordedByAccountId,
    VaccinationRecord,
    VaccinationRecordId,
} from '../../domain/vaccination-record/vaccination-record';
import { VaccineName } from '../../domain/vaccine-name/vaccine-name';
import type {
    UpdateVaccinationRecordOutcome,
    VaccinationRecordRepository,
} from '../persistence/vaccination-record.repository';
import {
    InvalidAppliedDateError,
    InvalidNextDueDateError,
    InvalidVaccineNameError,
    PetNotFoundError,
} from '../record-vaccination/record-vaccination';
import type { Clock } from '../time/clock';
import {
    UpdateVaccinationRecord,
    VaccinationRecordNotFoundError,
    type UpdateVaccinationRecordCommand,
} from './update-vaccination-record';

const petId: string = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const vaccinationRecordId: string = '6fe44a29-206e-4875-9f3e-72026868135e';
const authenticatedAccountId: string = '550e8400-e29b-41d4-a716-446655440000';
const originalAccountId: string = '9b4a221a-e6ad-41ab-b1b2-21230b8b65a4';

function command(
    overrides: Partial<UpdateVaccinationRecordCommand> = {},
): UpdateVaccinationRecordCommand {
    return {
        petId,
        vaccinationRecordId,
        authenticatedAccountId,
        vaccineName: '  Rabies Booster  ',
        ...overrides,
    };
}

function record(): VaccinationRecord {
    return VaccinationRecord.reconstitute({
        id: VaccinationRecordId.from(vaccinationRecordId),
        petId: PetId.from(petId),
        vaccineName: VaccineName.from('Rabies'),
        appliedDate: AppliedDate.from('2026-01-01', '2026-09-27'),
        nextDueDate: NextDueDate.from('2027-01-01'),
        recordedByAccountId: RecordedByAccountId.from(originalAccountId),
    });
}

function setup(outcome?: UpdateVaccinationRecordOutcome) {
    const correctIfPetWritable = jest
        .fn<
            ReturnType<VaccinationRecordRepository['correctIfPetWritable']>,
            Parameters<VaccinationRecordRepository['correctIfPetWritable']>
        >()
        .mockImplementation((correction) => {
            if (outcome !== undefined) {
                return Promise.resolve(outcome);
            }

            const current: VaccinationRecord = record();
            const corrected: VaccinationRecord = current.correct(correction);

            return Promise.resolve({
                status: corrected === current ? 'UNCHANGED' : 'UPDATED',
                record: corrected,
            });
        });
    const repository: VaccinationRecordRepository = {
        createIfPetWritable: jest.fn(),
        correctIfPetWritable,
        deleteIfPetWritable: jest.fn(),
    };
    const now = jest.fn((): Date => new Date('2026-09-27T00:30:00.000Z'));
    const clock: Clock = { now };

    return {
        useCase: new UpdateVaccinationRecord(repository, clock),
        correctIfPetWritable,
        now,
    };
}

describe('UpdateVaccinationRecord', () => {
    it.each([
        [command(), 'Rabies Booster', '2026-01-01', '2027-01-01'],
        [
            command({ vaccineName: undefined, appliedDate: '2026-02-01' }),
            'Rabies',
            '2026-02-01',
            '2027-01-01',
        ],
        [
            command({ vaccineName: undefined, nextDueDate: '2028-01-01' }),
            'Rabies',
            '2026-01-01',
            '2028-01-01',
        ],
        [command({ vaccineName: undefined, nextDueDate: null }), 'Rabies', '2026-01-01', null],
        [
            command({
                vaccineName: 'Distemper',
                appliedDate: '2026-03-01',
                nextDueDate: '2027-03-01',
            }),
            'Distemper',
            '2026-03-01',
            '2027-03-01',
        ],
    ] as const)(
        'returns corrected resource with original author for %j',
        async (input, vaccineName, appliedDate, nextDueDate) => {
            const { useCase, correctIfPetWritable, now } = setup();

            await expect(useCase.execute(input)).resolves.toEqual({
                id: vaccinationRecordId,
                petId,
                vaccineName,
                appliedDate,
                nextDueDate,
                recordedByAccountId: originalAccountId,
            });
            expect(correctIfPetWritable).toHaveBeenCalledTimes(1);
            expect(now).toHaveBeenCalledTimes(1);
        },
    );

    it('preserves omitted due date and returns the current record for no-op', async () => {
        const { useCase, correctIfPetWritable } = setup();
        const result = await useCase.execute(command({ vaccineName: ' Rabies ' }));

        expect(result).toMatchObject({
            vaccineName: 'Rabies',
            nextDueDate: '2027-01-01',
        });
        expect(correctIfPetWritable.mock.calls[0]?.[0].nextDueDate).toBeUndefined();
    });

    it.each([
        [command({ vaccineName: '' }), InvalidVaccineNameError, false],
        [command({ vaccineName: 'x'.repeat(256) }), InvalidVaccineNameError, false],
        [
            command({ vaccineName: undefined, appliedDate: '2026-09-28' }),
            InvalidAppliedDateError,
            false,
        ],
        [
            command({ vaccineName: undefined, appliedDate: '2026-02-29' }),
            InvalidAppliedDateError,
            false,
        ],
        [
            command({ vaccineName: undefined, nextDueDate: '2027-02-29' }),
            InvalidNextDueDateError,
            false,
        ],
        [
            command({ vaccineName: undefined, nextDueDate: '2025-12-31' }),
            InvalidNextDueDateError,
            true,
        ],
        [
            command({
                vaccineName: undefined,
                appliedDate: '2026-06-01',
                nextDueDate: '2026-03-01',
            }),
            InvalidNextDueDateError,
            true,
        ],
    ] as const)(
        'rejects invalid correction %j',
        async (input, errorClass, shouldReachPersistence) => {
            const { useCase, correctIfPetWritable } = setup();

            await expect(useCase.execute(input)).rejects.toThrow(errorClass);
            expect(correctIfPetWritable).toHaveBeenCalledTimes(shouldReachPersistence ? 1 : 0);
        },
    );

    it('maps missing pet and record outcomes and propagates persistence failures', async () => {
        await expect(setup({ status: 'PET_NOT_FOUND' }).useCase.execute(command())).rejects.toThrow(
            PetNotFoundError,
        );
        await expect(
            setup({ status: 'VACCINATION_RECORD_NOT_FOUND' }).useCase.execute(command()),
        ).rejects.toThrow(VaccinationRecordNotFoundError);
        const failing = setup();

        failing.correctIfPetWritable.mockRejectedValue(new Error('database failure'));
        await expect(failing.useCase.execute(command())).rejects.toThrow('database failure');
    });
});
