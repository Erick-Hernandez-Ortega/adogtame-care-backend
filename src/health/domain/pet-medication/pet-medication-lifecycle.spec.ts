import {
    PetMedication,
    PetId,
    RecordedByAccountId,
    InvalidMedicationEndedDateValueError,
    InvalidMedicationDiscontinuationReasonValueError,
    MedicationLifecycleConflictError,
} from './pet-medication';

function medication(startDate: string | null = null): PetMedication {
    return PetMedication.create({
        petId: PetId.from('b30a4c42-84e5-4765-99d4-1efb17f09c12'),
        recordedByAccountId: RecordedByAccountId.from('550e8400-e29b-41d4-a716-446655440000'),
        name: 'Amoxicillin',
        startDate,
        plannedEndDate: '2099-10-17',
    });
}

function today(): string {
    return '2026-10-11';
}

describe('PetMedication lifecycle', () => {
    it.each([null, '2099-10-10'])(
        'creates OPEN independently of indicated start %s',
        (startDate) => {
            expect(medication(startDate)).toMatchObject({
                status: 'OPEN',
                endedDate: null,
                discontinuationReason: null,
            });
        },
    );

    it.each(['complete', 'discontinue'] as const)(
        '%s preserves identity, author and indication without mutation',
        (action) => {
            const original: PetMedication = medication();
            const closed: PetMedication = original[action]({ endedDate: '2026-10-11' }, today);

            expect(closed).toMatchObject({
                ...original,
                status: action === 'complete' ? 'COMPLETED' : 'DISCONTINUED',
                endedDate: { value: '2026-10-11' },
            });
            expect(original.status).toBe('OPEN');
            expect(closed.id).toBe(original.id);
            expect(closed.recordedByAccountId).toBe(original.recordedByAccountId);
        },
    );

    it.each(['complete', 'discontinue'] as const)(
        '%s accepts unknown event date without consulting time',
        (action) => {
            const getToday = jest.fn<string, []>();
            const closed: PetMedication = medication('2099-10-10')[action](
                { endedDate: null },
                getToday,
            );

            expect(closed.endedDate).toBeNull();
            expect(getToday).not.toHaveBeenCalled();
        },
    );

    it('permits withdrawal before indicated start and completion without a known start', () => {
        expect(
            medication('2099-10-10').discontinue({ endedDate: '2026-10-01' }, today).status,
        ).toBe('DISCONTINUED');
        expect(medication().complete({ endedDate: '2026-10-01' }, today).status).toBe('COMPLETED');
        expect(() => medication('2099-10-10').complete({ endedDate: '2026-10-01' }, today)).toThrow(
            InvalidMedicationEndedDateValueError,
        );
    });

    it.each(['2026-10-10', '2026-10-11'])(
        'permits inclusive completion %s independent of planned end',
        (endedDate) => {
            expect(medication('2026-10-10').complete({ endedDate }, today).status).toBe(
                'COMPLETED',
            );
        },
    );

    it('permits completion after planned end', () => {
        const original: PetMedication = medication('2026-10-01').correct({
            plannedEndDate: '2026-10-02',
        });

        expect(original.complete({ endedDate: '2026-10-11' }, today).status).toBe('COMPLETED');
    });

    it.each(['2026-10-12', '2026-02-29', '0000-01-01', '10000-01-01', '2026-10-11 ', ''])(
        'rejects invalid or future closure %s',
        (endedDate) => {
            expect(() => medication().complete({ endedDate }, today)).toThrow(
                InvalidMedicationEndedDateValueError,
            );
            expect(() => medication().discontinue({ endedDate }, today)).toThrow(
                InvalidMedicationEndedDateValueError,
            );
        },
    );

    it('normalizes an optional reason with Unicode limits', () => {
        expect(
            medication().discontinue(
                { endedDate: null, discontinuationReason: ' Withdrawn ' },
                today,
            ).discontinuationReason,
        ).toBe('Withdrawn');
        expect(
            medication().discontinue(
                { endedDate: null, discontinuationReason: '🐕'.repeat(2000) },
                today,
            ).discontinuationReason,
        ).toBe('🐕'.repeat(2000));
    });

    it.each(['', ' ', '🐕'.repeat(2001)])('rejects an invalid reason', (discontinuationReason) => {
        expect(() =>
            medication().discontinue({ endedDate: null, discontinuationReason }, today),
        ).toThrow(InvalidMedicationDiscontinuationReasonValueError);
    });

    it('compares normalized retries rather than replacing the first report', () => {
        const closed: PetMedication = medication().discontinue(
            { endedDate: '2026-10-10', discontinuationReason: ' Withdrawn ' },
            today,
        );

        expect(
            closed.discontinue(
                { endedDate: '2026-10-10', discontinuationReason: 'Withdrawn' },
                today,
            ),
        ).toBe(closed);
        expect(() =>
            closed.discontinue({ endedDate: null, discontinuationReason: 'Withdrawn' }, today),
        ).toThrow(MedicationLifecycleConflictError);
        expect(() =>
            closed.discontinue({ endedDate: '2026-10-10', discontinuationReason: 'Other' }, today),
        ).toThrow(MedicationLifecycleConflictError);
        expect(() => closed.discontinue({ endedDate: '2026-10-12' }, today)).toThrow(
            InvalidMedicationEndedDateValueError,
        );
        expect(() => closed.complete({ endedDate: null }, today)).toThrow(
            MedicationLifecycleConflictError,
        );
    });

    it('supports completion retries and forbids changing closure type', () => {
        const closed: PetMedication = medication().complete({ endedDate: null }, today);

        expect(closed.complete({ endedDate: null }, today)).toBe(closed);
        expect(() => closed.complete({ endedDate: '2026-10-10' }, today)).toThrow(
            MedicationLifecycleConflictError,
        );
        expect(() => closed.discontinue({ endedDate: null }, today)).toThrow(
            MedicationLifecycleConflictError,
        );
    });

    it('corrects closure details while preserving status and checks the resulting chronology', () => {
        const closed: PetMedication = medication('2026-10-01').complete(
            { endedDate: '2026-10-10' },
            today,
        );

        expect(closed.correct({ endedDate: null }).status).toBe('COMPLETED');
        expect(closed.correct({ endedDate: '2026-10-10' }, today)).toBe(closed);
        expect(() => closed.correct({ startDate: '2026-10-11' })).toThrow(
            InvalidMedicationEndedDateValueError,
        );
        expect(() => closed.correct({ endedDate: '2026-10-12' }, today)).toThrow(
            InvalidMedicationEndedDateValueError,
        );
        expect(
            closed.correct({ startDate: '2026-10-11', endedDate: '2026-10-11' }, today).startDate
                ?.value,
        ).toBe('2026-10-11');
        expect(() => closed.correct({ discontinuationReason: null })).toThrow(
            MedicationLifecycleConflictError,
        );
        expect(() => medication().correct({ endedDate: null })).toThrow(
            MedicationLifecycleConflictError,
        );
    });

    it('corrects reasons and reopens by permanently clearing closure details', () => {
        const closed: PetMedication = medication().discontinue(
            { endedDate: '2026-10-10', discontinuationReason: 'Withdrawn' },
            today,
        );
        const corrected: PetMedication = closed.correct({
            discontinuationReason: null,
            endedDate: null,
        });
        const reopened: PetMedication = closed.reopen();

        expect(corrected.status).toBe('DISCONTINUED');
        expect(corrected.discontinuationReason).toBeNull();
        expect(reopened).toMatchObject({
            ...medication(),
            id: closed.id,
            status: 'OPEN',
            endedDate: null,
            discontinuationReason: null,
        });
        expect(reopened.reopen()).toBe(reopened);
        expect(reopened.complete({ endedDate: null }, today).id).toBe(closed.id);
    });

    it('reconstitutes historical closure without consulting the present clock', () => {
        const original: PetMedication = medication();
        const persisted = {
            id: original.id,
            petId: original.petId,
            recordedByAccountId: original.recordedByAccountId,
            name: original.name.value,
            dosage: null,
            frequency: null,
            startDate: null,
            plannedEndDate: '2099-10-17',
            notes: null,
            status: 'COMPLETED',
            endedDate: '2099-01-01',
            discontinuationReason: null,
        };
        const historical: PetMedication = PetMedication.reconstitute(persisted);

        expect(historical.correct({ notes: 'Historical' }).endedDate?.value).toBe('2099-01-01');
        expect(() => PetMedication.reconstitute({ ...persisted, status: 'OPEN' })).toThrow(
            TypeError,
        );
        expect(() =>
            PetMedication.reconstitute({ ...persisted, discontinuationReason: 'Invalid' }),
        ).toThrow(TypeError);
        expect(() => PetMedication.reconstitute({ ...persisted, status: 'UNKNOWN' })).toThrow(
            TypeError,
        );
        expect(() =>
            PetMedication.reconstitute({
                ...persisted,
                status: 'DISCONTINUED',
                discontinuationReason: ' Unnormalized ',
            }),
        ).toThrow(TypeError);
    });
});
