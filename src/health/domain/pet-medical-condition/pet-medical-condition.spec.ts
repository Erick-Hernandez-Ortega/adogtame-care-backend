import { InvalidMedicalConditionResolvedDateValueError } from './pet-medical-condition';
import { ResolvedDate } from '../resolved-date/resolved-date';
import { DiagnosedDate } from '../diagnosed-date/diagnosed-date';
import { MedicalConditionName } from '../medical-condition-name/medical-condition-name';
import {
    InvalidMedicalConditionNotesValueError,
    InvalidMedicalConditionNameValueError,
    InvalidMedicalConditionDiagnosedDateValueError,
    MedicalConditionStatus,
    PetMedicalCondition,
    PetMedicalConditionId,
    PetId,
    RecordedByAccountId,
} from './pet-medical-condition';

const petId: string = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const accountId: string = '550e8400-e29b-41d4-a716-446655440000';

function input() {
    return {
        petId: PetId.from(petId),
        name: MedicalConditionName.from('Epilepsy'),
        diagnosedDate: DiagnosedDate.from('2026-03-14', '2026-03-14'),
        recordedByAccountId: RecordedByAccountId.from(accountId),
    };
}

describe('PetMedicalCondition', () => {
    it('generates independent UUID v4 identities and preserves functional information', () => {
        const condition: PetMedicalCondition = PetMedicalCondition.create(input());

        expect(condition.id.value).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(PetMedicalCondition.create(input()).id.value).not.toBe(condition.id.value);
        expect(condition.petId.value).toBe(petId);
        expect(condition.name.value).toBe('Epilepsy');
        expect(condition.diagnosedDate?.value).toBe('2026-03-14');
        expect(condition.recordedByAccountId.value).toBe(accountId);
        expect(condition.status).toBe(MedicalConditionStatus.ACTIVE);
        expect(PetMedicalConditionId.from(condition.id.value.toUpperCase()).value).toBe(
            condition.id.value,
        );
    });
    it.each([undefined, null])(
        'normalizes absent date and notes %s to null',
        (value: undefined | null) => {
            const condition: PetMedicalCondition = PetMedicalCondition.create({
                ...input(),
                diagnosedDate: value,
                notes: value,
            });

            expect(condition.diagnosedDate).toBeNull();
            expect(condition.notes).toBeNull();
        },
    );
    it('trims notes and accepts exactly 2000 Unicode code points', () => {
        expect(
            PetMedicalCondition.create({
                ...input(),
                notes: '  Monitored regularly.  ',
            }).notes,
        ).toBe('Monitored regularly.');
        expect(PetMedicalCondition.create({ ...input(), notes: '🐕'.repeat(2000) }).notes).toBe(
            '🐕'.repeat(2000),
        );
    });
    it.each(['', ' ', '\t\n', '🐕'.repeat(2001), 1, {}])(
        'rejects invalid notes %s',
        (value: unknown) => {
            expect(() =>
                PetMedicalCondition.create({ ...input(), notes: value as string }),
            ).toThrow(InvalidMedicalConditionNotesValueError);
        },
    );
    it('rejects invalid aggregate runtime data', () => {
        expect(() =>
            PetMedicalCondition.create({
                ...input(),
                petId: petId as unknown as PetId,
            }),
        ).toThrow(TypeError);
        expect(() =>
            PetMedicalCondition.create({
                ...input(),
                name: 'Epilepsy' as unknown as MedicalConditionName,
            }),
        ).toThrow(TypeError);
        expect(() =>
            PetMedicalCondition.create({
                ...input(),
                diagnosedDate: '2026-03-14' as unknown as DiagnosedDate,
            }),
        ).toThrow(TypeError);
        expect(() =>
            PetMedicalCondition.create({
                ...input(),
                recordedByAccountId: accountId as unknown as RecordedByAccountId,
            }),
        ).toThrow(TypeError);
    });
    it.each(['bad', '00000000-0000-0000-0000-000000000000'])(
        'rejects invalid reference identities %s',
        (value: string) => {
            expect(() => PetId.from(value)).toThrow(TypeError);
            expect(() => RecordedByAccountId.from(value)).toThrow(TypeError);
            expect(() => PetMedicalConditionId.from(value)).toThrow(TypeError);
        },
    );
    it('normalizes uppercase reference UUIDs', () => {
        expect(PetId.from(petId.toUpperCase()).value).toBe(petId);
        expect(RecordedByAccountId.from(accountId.toUpperCase()).value).toBe(accountId);
    });
});

describe('PetMedicalCondition correction', () => {
    function restored(
        status: string = 'ACTIVE',
        diagnosedDate: string | null = '2026-03-14',
    ): PetMedicalCondition {
        return PetMedicalCondition.reconstitute({
            ...input(),
            id: PetMedicalConditionId.from('550e8400-e29b-41d4-a716-446655440001'),
            status,
            diagnosedDate:
                diagnosedDate === null ? null : DiagnosedDate.reconstitute(diagnosedDate),
            notes: 'Original notes',
        });
    }

    it.each(['ACTIVE', 'RESOLVED'])(
        'reconstitutes and corrects %s without changing identity or lifecycle',
        (status: string) => {
            const original: PetMedicalCondition = restored(status);
            const corrected: PetMedicalCondition = original.correct(
                {
                    name: '  Osteoarthritis  ',
                    diagnosedDate: '2026-02-10',
                    notes: '  Corrected notes  ',
                },
                '2026-03-14',
            );

            expect(corrected).not.toBe(original);
            expect(corrected).toMatchObject({
                id: original.id,
                petId: original.petId,
                recordedByAccountId: original.recordedByAccountId,
                status,
                notes: 'Corrected notes',
            });
            expect(corrected.name.value).toBe('Osteoarthritis');
            expect(corrected.diagnosedDate?.value).toBe('2026-02-10');
            expect(original.name.value).toBe('Epilepsy');
            expect(original.notes).toBe('Original notes');
            expect(original.diagnosedDate?.value).toBe('2026-03-14');
        },
    );
    it.each(['ACTIVE', 'RESOLVED'])(
        'returns the same %s instance for normalized no-ops',
        (status: string) => {
            const original: PetMedicalCondition = restored(status);

            for (const patch of [
                { name: ' Epilepsy ' },
                { diagnosedDate: '2026-03-14' },
                { notes: ' Original notes ' },
            ]) {
                expect(original.correct(patch, '2026-03-14')).toBe(original);
            }

            const unknown: PetMedicalCondition = restored(status, null).correct(
                { notes: null },
                '2026-03-14',
            );

            expect(unknown.correct({ diagnosedDate: null, notes: null }, '2026-03-14')).toBe(
                unknown,
            );
        },
    );
    it('preserves omitted fields and clears nullable fields independently', () => {
        const original: PetMedicalCondition = restored();

        expect(original.correct({ name: 'Arthritis' }, '2026-03-14')).toMatchObject({
            diagnosedDate: original.diagnosedDate,
            notes: original.notes,
        });
        expect(original.correct({ diagnosedDate: null }, '2026-03-14')).toMatchObject({
            name: original.name,
            diagnosedDate: null,
            notes: original.notes,
        });
        expect(original.correct({ notes: null }, '2026-03-14')).toMatchObject({
            diagnosedDate: original.diagnosedDate,
            notes: null,
        });
        expect(
            restored('ACTIVE', null).correct({ diagnosedDate: '2026-03-14' }, '2026-03-14')
                .diagnosedDate?.value,
        ).toBe('2026-03-14');
    });
    it('preserves a structurally valid historical date beyond the current Clock when omitted', () => {
        const original: PetMedicalCondition = restored('RESOLVED', '2027-01-01');

        expect(
            original.correct({ notes: 'Corrected history' }, '2026-03-14').diagnosedDate?.value,
        ).toBe('2027-01-01');
        expect(original.correct({ name: ' Epilepsy ' }, '2026-03-14')).toBe(original);
        expect(() => original.correct({ diagnosedDate: '2027-01-01' }, '2026-03-14')).toThrow(
            InvalidMedicalConditionDiagnosedDateValueError,
        );
    });
    it.each([
        [{ name: '' }, InvalidMedicalConditionNameValueError],
        [{ name: '  ' }, InvalidMedicalConditionNameValueError],
        [{ name: '🐕'.repeat(256) }, InvalidMedicalConditionNameValueError],
        [{ diagnosedDate: '2026-02-29' }, InvalidMedicalConditionDiagnosedDateValueError],
        [{ diagnosedDate: '2026-03-15' }, InvalidMedicalConditionDiagnosedDateValueError],
        [{ diagnosedDate: '2026' }, InvalidMedicalConditionDiagnosedDateValueError],
        [{ notes: '' }, InvalidMedicalConditionNotesValueError],
        [{ name: 'Changed', notes: '  ' }, InvalidMedicalConditionNotesValueError],
        [{ notes: '🐕'.repeat(2001) }, InvalidMedicalConditionNotesValueError],
    ])('rejects correction %j without partial mutation', (patch, errorClass) => {
        const original: PetMedicalCondition = restored();

        expect(() => original.correct(patch, '2026-03-14')).toThrow(errorClass);
        expect(original).toEqual(restored());
    });
    it('rejects empty corrections and unsupported persisted status', () => {
        expect(() => restored().correct({}, '2026-03-14')).toThrow(TypeError);
        expect(() => restored('UNKNOWN')).toThrow(TypeError);
    });
});

describe('PetMedicalCondition resolution', () => {
    const create = (): PetMedicalCondition =>
        PetMedicalCondition.create({
            petId: PetId.from('550e8400-e29b-41d4-a716-446655440001'),
            recordedByAccountId: RecordedByAccountId.from('550e8400-e29b-41d4-a716-446655440002'),
            name: MedicalConditionName.from('Dermatitis'),
            diagnosedDate: DiagnosedDate.from('2026-02-15', '2026-03-14'),
            notes: 'Clinical notes',
        });

    it.each(['2026-03-14', '2026-01-01', null])(
        'resolves with %s preserving identity and clinical data',
        (resolvedDate) => {
            const original: PetMedicalCondition = create();
            const resolved: PetMedicalCondition = original.resolve({ resolvedDate }, '2026-03-14');

            expect(resolved).not.toBe(original);
            expect(original.status).toBe('ACTIVE');
            expect(original.resolvedDate).toBeNull();
            expect(resolved).toMatchObject({
                ...original,
                status: 'RESOLVED',
                resolvedDate: resolvedDate === null ? null : { value: resolvedDate },
            });
            expect(resolved.id).toBe(original.id);
            expect(resolved.recordedByAccountId).toBe(original.recordedByAccountId);
        },
    );

    it.each(['2026-03-14', null])(
        'preserves original %s date and same instance on every retry',
        (resolvedDate) => {
            const resolved: PetMedicalCondition = create().resolve({ resolvedDate }, '2026-03-14');

            for (const retryDate of [null, '2026-03-13', 'invalid', '9999-01-01']) {
                expect(resolved.resolve({ resolvedDate: retryDate }, '2000-01-01')).toBe(resolved);
            }

            expect(resolved.correct({ notes: 'Corrected' }, '2000-01-01').resolvedDate).toBe(
                resolved.resolvedDate,
            );
            expect(
                resolved.correct({ diagnosedDate: '2026-03-14' }, '2026-03-14').resolvedDate,
            ).toBe(resolved.resolvedDate);
        },
    );

    it.each(['', '2026-02-29', '2026-03-15', '2026-3-14', '0000-01-01'])(
        'rejects invalid new date %s',
        (resolvedDate) => {
            expect(() => create().resolve({ resolvedDate }, '2026-03-14')).toThrow(
                InvalidMedicalConditionResolvedDateValueError,
            );
        },
    );

    it('reconstitutes persisted dates without temporal validation and enforces status consistency', () => {
        const original: PetMedicalCondition = create();
        const resolvedDate: ResolvedDate = ResolvedDate.reconstitute('2027-01-01');

        expect(() =>
            PetMedicalCondition.reconstitute({ ...original, status: 'ACTIVE', resolvedDate }),
        ).toThrow('Active medical conditions');
        const restored: PetMedicalCondition = PetMedicalCondition.reconstitute({
            ...original,
            status: 'RESOLVED',
            resolvedDate,
        });

        expect(restored.resolvedDate).toBe(resolvedDate);
        expect(restored.correct({ name: 'Updated' }, '2000-01-01').resolvedDate).toBe(resolvedDate);
        expect(
            PetMedicalCondition.reconstitute({
                ...original,
                status: 'RESOLVED',
                resolvedDate: null,
            }).resolvedDate,
        ).toBeNull();
    });
});
