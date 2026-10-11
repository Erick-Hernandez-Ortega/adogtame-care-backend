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

function persistedInput() {
    return {
        id: PetMedicationId.from('80db31a0-aeb9-4768-b103-770110b39fd8'),
        ...input(),
        name: 'Amoxicillin',
        dosage: 'Half tablet',
        frequency: 'As needed',
        notes: 'Give with food',
    };
}

describe('PetMedication reconstitution and correction', () => {
    it('reconstitutes exact persisted values without generating identity or consulting time', () => {
        const persisted = Object.freeze(persistedInput());
        const medication: PetMedication = PetMedication.reconstitute(persisted);

        expect(medication).toMatchObject({
            id: persisted.id,
            petId: persisted.petId,
            recordedByAccountId: persisted.recordedByAccountId,
            name: { value: persisted.name },
            dosage: persisted.dosage,
            frequency: persisted.frequency,
            startDate: { value: persisted.startDate },
            plannedEndDate: { value: persisted.plannedEndDate },
            notes: persisted.notes,
        });
        expect(
            PetMedication.reconstitute({
                ...persisted,
                dosage: null,
                frequency: null,
                startDate: null,
                plannedEndDate: null,
                notes: null,
            }).notes,
        ).toBeNull();
    });

    it.each([
        { name: ' Amoxicillin ' },
        { dosage: ' Half tablet ' },
        { frequency: ' As needed ' },
        { notes: ' Give with food ' },
        { name: '' },
        { name: null },
        { dosage: '' },
        { frequency: '' },
        { notes: '' },
        { name: '🐕'.repeat(256) },
        { dosage: '🐕'.repeat(2001) },
        { frequency: '🐕'.repeat(2001) },
        { notes: '🐕'.repeat(2001) },
        { dosage: undefined },
        { frequency: undefined },
        { startDate: undefined },
        { plannedEndDate: undefined },
        { notes: undefined },
        { dosage: 1 },
        { frequency: false },
        { notes: {} },
        { startDate: '2026-02-29' },
        { plannedEndDate: '2099-10-09' },
        { startDate: ' 2099-10-10' },
        { plannedEndDate: '9999-12-32' },
        { id: 'invalid' },
        { petId: 'invalid' },
        { recordedByAccountId: 'invalid' },
    ])('rejects persisted corruption %j without a PATCH semantic error', (invalid) => {
        const persisted = { ...persistedInput(), ...invalid };

        try {
            PetMedication.reconstitute(
                persisted as unknown as Parameters<typeof PetMedication.reconstitute>[0],
            );
            throw new Error('Expected invalid persisted data');
        } catch (error: unknown) {
            expect(error?.constructor).toBe(TypeError);
            expect((error as TypeError).message).toBe('Persisted pet medication data is invalid');
        }
    });

    it.each([
        [{ name: '  Another medication  ' }, { name: { value: 'Another medication' } }],
        [{ dosage: '  5 mL  ' }, { dosage: '5 mL' }],
        [{ frequency: '  Once daily  ' }, { frequency: 'Once daily' }],
        [{ startDate: '2099-10-12' }, { startDate: { value: '2099-10-12' } }],
        [{ plannedEndDate: '2099-10-20' }, { plannedEndDate: { value: '2099-10-20' } }],
        [{ notes: '  New notes  ' }, { notes: 'New notes' }],
    ] as const)('corrects one field %j and preserves the others', (patch, expected) => {
        const medication: PetMedication = PetMedication.reconstitute(persistedInput());
        const corrected: PetMedication = medication.correct(patch);

        expect(corrected).not.toBe(medication);
        expect(corrected).toMatchObject({ ...medication, ...expected });
    });

    it('corrects multiple fields without mutating input or the original aggregate', () => {
        const medication: PetMedication = Object.freeze(
            PetMedication.reconstitute(persistedInput()),
        );
        const patch = Object.freeze({
            name: ' Other drug ',
            dosage: null,
            frequency: ' Daily ',
            startDate: '2100-01-01',
            plannedEndDate: '2100-01-02',
            notes: null,
        });
        const corrected: PetMedication = medication.correct(patch);

        expect(corrected).toMatchObject({
            name: { value: 'Other drug' },
            dosage: null,
            frequency: 'Daily',
            startDate: { value: '2100-01-01' },
            plannedEndDate: { value: '2100-01-02' },
            notes: null,
        });
        expect(corrected.id).toBe(medication.id);
        expect(corrected.petId).toBe(medication.petId);
        expect(corrected.recordedByAccountId).toBe(medication.recordedByAccountId);
        expect(medication.name.value).toBe('Amoxicillin');
        expect(medication.dosage).toBe('Half tablet');
        expect(patch.name).toBe(' Other drug ');
    });

    it.each(['dosage', 'frequency', 'startDate', 'plannedEndDate', 'notes'] as const)(
        'distinguishes omission from explicit null for %s',
        (field) => {
            const medication: PetMedication = PetMedication.reconstitute(persistedInput());
            const preserved: PetMedication = medication.correct({ name: 'Other drug' });
            const cleared: PetMedication = medication.correct({ [field]: null });

            expect(preserved[field]).toEqual(medication[field]);
            expect(cleared[field]).toBeNull();
            expect(medication[field]).not.toBeNull();
        },
    );

    it.each([
        { name: 'Amoxicillin' },
        { name: ' Amoxicillin ' },
        { dosage: ' Half tablet ', frequency: ' As needed ', notes: ' Give with food ' },
        { startDate: '2099-10-10', plannedEndDate: '2099-10-17' },
    ])('returns the same instance for normalized no-op %j', (patch) => {
        const medication: PetMedication = PetMedication.reconstitute(persistedInput());

        expect(medication.correct(patch)).toBe(medication);
    });

    it('returns the same instance when clearing already absent values', () => {
        const medication: PetMedication = PetMedication.create({
            petId: PetId.from(petId),
            recordedByAccountId: RecordedByAccountId.from(accountId),
            name: 'Drug',
        });

        expect(
            medication.correct({
                dosage: null,
                frequency: null,
                startDate: null,
                plannedEndDate: null,
                notes: null,
            }),
        ).toBe(medication);
        expect(() => medication.correct({})).toThrow(TypeError);
    });

    it.each([{ startDate: '2099-10-18' }, { plannedEndDate: '2099-10-09' }])(
        'validates the resulting interval against the omitted date %j',
        (patch) => {
            const medication: PetMedication = PetMedication.reconstitute(persistedInput());

            expect(() => medication.correct(patch)).toThrow(
                InvalidMedicationPlannedEndDateValueError,
            );
            expect(medication.startDate?.value).toBe('2099-10-10');
            expect(medication.plannedEndDate?.value).toBe('2099-10-17');
        },
    );

    it.each([
        { startDate: '2099-10-17' },
        { plannedEndDate: '2099-10-10' },
        { startDate: '2100-01-01', plannedEndDate: '2100-01-02' },
        { startDate: '0001-01-01', plannedEndDate: '9999-12-31' },
        { startDate: null },
        { plannedEndDate: null },
    ])('permits a valid resulting interval %j', (patch) => {
        const medication: PetMedication = PetMedication.reconstitute(persistedInput());

        expect(() => medication.correct(patch)).not.toThrow();
    });

    it.each([
        ['name', 255, InvalidMedicationNameValueError],
        ['dosage', 2000, InvalidMedicationDosageValueError],
        ['frequency', 2000, InvalidMedicationFrequencyValueError],
        ['notes', 2000, InvalidMedicationNotesValueError],
    ] as const)('enforces trimmed Unicode limits and nonempty %s', (field, limit, ErrorClass) => {
        const medication: PetMedication = PetMedication.reconstitute(persistedInput());

        expect(() => medication.correct({ [field]: ` ${'🐕'.repeat(limit)} ` })).not.toThrow();
        expect(() => medication.correct({ [field]: '🐕'.repeat(limit + 1) })).toThrow(ErrorClass);
        expect(() => medication.correct({ [field]: ' \t\n ' })).toThrow(ErrorClass);
    });

    it.each(['2026-02-29', '2026-01', '', '2099-10-10 ', '0000-01-01', '10000-01-01'])(
        'rejects invalid date %s with the corresponding error',
        (value: string) => {
            const medication: PetMedication = PetMedication.reconstitute(persistedInput());

            expect(() => medication.correct({ startDate: value })).toThrow(
                InvalidMedicationStartDateValueError,
            );
            expect(() => medication.correct({ plannedEndDate: value })).toThrow(
                InvalidMedicationPlannedEndDateValueError,
            );
        },
    );
});
