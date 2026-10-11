import {
    PetMedicationId as RecordIdentifier,
    PetId as ReferencePetId,
    RecordedByAccountId as AuthorAccountId,
} from './pet-medication';
import {
    PetMedication,
    PetMedicationId,
    PetId,
    RecordedByAccountId,
    InvalidMedicationNameValueError,
    InvalidMedicationDosageValueError,
    InvalidMedicationFrequencyValueError,
    InvalidMedicationStartDateValueError,
    InvalidMedicationPlannedEndDateValueError,
    InvalidMedicationNotesValueError,
} from './pet-medication';

const petId: string = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const accountId: string = '550e8400-e29b-41d4-a716-446655440000';

function input() {
    return {
        petId: PetId.from(petId),
        recordedByAccountId: RecordedByAccountId.from(accountId),
        name: '  Amoxicillin  ',
        dosage: '  Half tablet  ',
        frequency: '  As needed  ',
        startDate: '2099-10-10',
        plannedEndDate: '2099-10-17',
        notes: '  Give with food  ',
    };
}

describe('PetMedication', () => {
    it('generates independent UUID v4 identities and preserves author and literal medication information', () => {
        const medication: PetMedication = PetMedication.create(input());
        const duplicate: PetMedication = PetMedication.create(input());

        expect(medication.id.value).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(duplicate.id.value).not.toBe(medication.id.value);
        expect(medication).toMatchObject({
            petId: { value: petId },
            recordedByAccountId: { value: accountId },
            name: { value: 'Amoxicillin' },
            dosage: 'Half tablet',
            frequency: 'As needed',
            startDate: { value: '2099-10-10' },
            plannedEndDate: { value: '2099-10-17' },
            notes: 'Give with food',
        });
        expect(medication).not.toHaveProperty('status');
    });

    it('does not mutate input or previously created records', () => {
        const original = input();
        const snapshot = { ...original };
        const medication: PetMedication = PetMedication.create(original);

        expect(original).toEqual(snapshot);
        original.name = 'Another drug';
        original.dosage = '5 mL';
        expect(medication.name.value).toBe('Amoxicillin');
        expect(medication.dosage).toBe('Half tablet');
        expect(snapshot.name).toBe('  Amoxicillin  ');
        expect(snapshot.petId).toBe(original.petId);
    });

    it.each([undefined, null])(
        'normalizes optional values %s to null',
        (value: undefined | null) => {
            const medication: PetMedication = PetMedication.create({
                ...input(),
                dosage: value,
                frequency: value,
                startDate: value,
                plannedEndDate: value,
                notes: value,
            });

            expect(medication).toMatchObject({
                dosage: null,
                frequency: null,
                startDate: null,
                plannedEndDate: null,
                notes: null,
            });
        },
    );

    it('allows each date independently, equal dates, future intervals and civil range boundaries', () => {
        expect(PetMedication.create({ ...input(), startDate: null }).startDate).toBeNull();
        expect(
            PetMedication.create({ ...input(), plannedEndDate: null }).plannedEndDate,
        ).toBeNull();
        expect(
            PetMedication.create({ ...input(), plannedEndDate: input().startDate }).plannedEndDate
                ?.value,
        ).toBe(input().startDate);
        expect(
            PetMedication.create({
                ...input(),
                startDate: '0001-01-01',
                plannedEndDate: '9999-12-31',
            }).plannedEndDate?.value,
        ).toBe('9999-12-31');
    });

    it('rejects an inverted interval as an invalid planned end date', () => {
        expect(() => PetMedication.create({ ...input(), plannedEndDate: '2099-10-09' })).toThrow(
            InvalidMedicationPlannedEndDateValueError,
        );
    });

    it.each(['250 mg', 'Half tablet', '5 mL', '1 tablet', 'Unknown units are not interpreted'])(
        'preserves dosage %s without calculations',
        (dosage: string) => {
            expect(PetMedication.create({ ...input(), dosage }).dosage).toBe(dosage);
        },
    );

    it.each([
        'Every 12 hours',
        'Once daily',
        'As needed',
        'Every Monday',
        'As directed by veterinarian',
    ])('preserves frequency %s without recurrence interpretation', (frequency: string) => {
        expect(PetMedication.create({ ...input(), frequency }).frequency).toBe(frequency);
    });

    it('accepts exact Unicode limits after trimming', () => {
        const medication: PetMedication = PetMedication.create({
            ...input(),
            name: ` ${'🐕'.repeat(255)} `,
            dosage: ` ${'🐕'.repeat(2000)} `,
            frequency: '🐕'.repeat(2000),
            notes: '🐕'.repeat(2000),
        });

        expect(medication.name.value).toBe('🐕'.repeat(255));
        expect(medication.dosage).toBe('🐕'.repeat(2000));
    });

    it.each(['', ' ', '\t\n', '🐕'.repeat(256), 1, {}])(
        'rejects invalid name %s',
        (value: unknown) => {
            expect(() => PetMedication.create({ ...input(), name: value as string })).toThrow(
                InvalidMedicationNameValueError,
            );
        },
    );

    it.each(['', ' ', '\t\n', '🐕'.repeat(2001), 1, {}])(
        'rejects invalid dosage %s',
        (value: unknown) => {
            expect(() => PetMedication.create({ ...input(), dosage: value as string })).toThrow(
                InvalidMedicationDosageValueError,
            );
        },
    );

    it.each(['', ' ', '\t\n', '🐕'.repeat(2001), 1, {}])(
        'rejects invalid frequency %s',
        (value: unknown) => {
            expect(() => PetMedication.create({ ...input(), frequency: value as string })).toThrow(
                InvalidMedicationFrequencyValueError,
            );
        },
    );

    it.each(['', ' ', '\t\n', '🐕'.repeat(2001), 1, {}])(
        'rejects invalid notes %s',
        (value: unknown) => {
            expect(() => PetMedication.create({ ...input(), notes: value as string })).toThrow(
                InvalidMedicationNotesValueError,
            );
        },
    );

    it.each(['2026-02-29', '0000-01-01', '10000-01-01', '2026-01', '', ' ', 1, {}])(
        'rejects invalid dates %s with field-specific errors',
        (value: unknown) => {
            expect(() => PetMedication.create({ ...input(), startDate: value as string })).toThrow(
                InvalidMedicationStartDateValueError,
            );
            expect(() =>
                PetMedication.create({ ...input(), plannedEndDate: value as string }),
            ).toThrow(InvalidMedicationPlannedEndDateValueError);
        },
    );

    it('validates name, dosage, frequency, start, planned end, then notes', () => {
        expect(() =>
            PetMedication.create({
                ...input(),
                name: '',
                dosage: '',
                frequency: '',
                startDate: 'bad',
                plannedEndDate: 'bad',
                notes: '',
            }),
        ).toThrow(InvalidMedicationNameValueError);
        expect(() =>
            PetMedication.create({
                ...input(),
                dosage: '',
                frequency: '',
                startDate: 'bad',
                notes: '',
            }),
        ).toThrow(InvalidMedicationDosageValueError);
        expect(() =>
            PetMedication.create({ ...input(), frequency: '', startDate: 'bad', notes: '' }),
        ).toThrow(InvalidMedicationFrequencyValueError);
        expect(() =>
            PetMedication.create({
                ...input(),
                startDate: 'bad',
                plannedEndDate: 'bad',
                notes: '',
            }),
        ).toThrow(InvalidMedicationStartDateValueError);
        expect(() =>
            PetMedication.create({ ...input(), plannedEndDate: 'bad', notes: '' }),
        ).toThrow(InvalidMedicationPlannedEndDateValueError);
    });

    it('requires typed pet and recording account identities', () => {
        expect(() =>
            PetMedication.create({ ...input(), petId: petId as unknown as PetId }),
        ).toThrow(TypeError);
        expect(() =>
            PetMedication.create({
                ...input(),
                recordedByAccountId: accountId as unknown as RecordedByAccountId,
            }),
        ).toThrow(TypeError);
    });

    it.each([PetMedicationId, PetId, RecordedByAccountId])(
        'normalizes valid UUID identities and rejects invalid or nil values',
        (Identifier) => {
            expect(Identifier.from(petId.toUpperCase()).value).toBe(petId);
            expect(() => Identifier.from('bad')).toThrow(TypeError);
            expect(() => Identifier.from(`${petId}\n`)).toThrow(TypeError);
            expect(() => Identifier.from('00000000-0000-0000-0000-000000000000')).toThrow(
                TypeError,
            );
        },
    );
});

describe('PetMedicationId shared UUID validation', () => {
    it.each([
        [RecordIdentifier, 'Pet medication ID'],
        [ReferencePetId, 'Pet ID'],
        [AuthorAccountId, 'Account ID'],
    ] as const)(
        'retains identifier-specific errors and normalization',
        (Identifier, label: string) => {
            const value: string = '550E8400-E29B-41D4-A716-446655440000';

            expect(Identifier.from(value).value).toBe(value.toLowerCase());
            expect(() => Identifier.from(`${value}\n`)).toThrow(
                new TypeError(`${label} must be a valid non-nil UUID`),
            );
        },
    );
});
