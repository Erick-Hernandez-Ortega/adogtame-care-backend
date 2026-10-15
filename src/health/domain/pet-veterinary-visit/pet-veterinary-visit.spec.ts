import { VisitDate } from '../visit-date/visit-date';
import { VeterinaryVisitReason } from '../veterinary-visit-reason/veterinary-visit-reason';
import {
    InvalidVeterinaryVisitDiagnosisValueError,
    InvalidVeterinaryVisitObservationsValueError,
    PetVeterinaryVisit,
    PetVeterinaryVisitId,
    PetId,
    RecordedByAccountId,
} from './pet-veterinary-visit';

function input() {
    return {
        petId: PetId.from('b30a4c42-84e5-4765-99d4-1efb17f09c12'),
        visitDate: VisitDate.from('2026-03-14', '2026-03-14'),
        reason: VeterinaryVisitReason.from('Annual checkup'),
        recordedByAccountId: RecordedByAccountId.from('550e8400-e29b-41d4-a716-446655440000'),
    };
}

describe('PetVeterinaryVisit', () => {
    it('generates independent identities for duplicate visits and preserves their data', () => {
        const visit: PetVeterinaryVisit = PetVeterinaryVisit.create(input());

        expect(visit.id.value).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(PetVeterinaryVisit.create(input()).id.value).not.toBe(visit.id.value);
        expect(visit).toMatchObject({ ...input(), diagnosis: null, observations: null });
        expect(PetVeterinaryVisit.reconstitute({ ...visit })).toEqual(visit);
    });

    it.each([null, undefined])('normalizes absent optional text %s', (value: null | undefined) => {
        expect(
            PetVeterinaryVisit.create({ ...input(), diagnosis: value, observations: value }),
        ).toMatchObject({ diagnosis: null, observations: null });
    });

    it('trims optional text, preserves casing and counts Unicode code points', () => {
        expect(
            PetVeterinaryVisit.create({
                ...input(),
                diagnosis: ' Healthy ',
                observations: ' Routine examination. ',
            }),
        ).toMatchObject({ diagnosis: 'Healthy', observations: 'Routine examination.' });
        expect(
            PetVeterinaryVisit.create({
                ...input(),
                diagnosis: '🐕'.repeat(2000),
                observations: '🐕'.repeat(5000),
            }),
        ).toMatchObject({ diagnosis: '🐕'.repeat(2000), observations: '🐕'.repeat(5000) });
    });

    it.each(['', ' ', '\t\n', '🐕'.repeat(2001), 1, {}])(
        'rejects invalid diagnosis %s',
        (value: unknown) => {
            expect(() =>
                PetVeterinaryVisit.create({ ...input(), diagnosis: value as string }),
            ).toThrow(InvalidVeterinaryVisitDiagnosisValueError);
        },
    );

    it.each(['', ' ', '\t\n', '🐕'.repeat(5001), 1, {}])(
        'rejects invalid observations %s',
        (value: unknown) => {
            expect(() =>
                PetVeterinaryVisit.create({ ...input(), observations: value as string }),
            ).toThrow(InvalidVeterinaryVisitObservationsValueError);
        },
    );

    it('rejects invalid runtime aggregate data', () => {
        expect(() =>
            PetVeterinaryVisit.create({ ...input(), petId: 'bad' as unknown as PetId }),
        ).toThrow(TypeError);
        expect(() =>
            PetVeterinaryVisit.create({
                ...input(),
                reason: 'Checkup' as unknown as VeterinaryVisitReason,
            }),
        ).toThrow(TypeError);
        expect(() =>
            PetVeterinaryVisit.create({ ...input(), visitDate: null as unknown as VisitDate }),
        ).toThrow(TypeError);
        expect(() =>
            PetVeterinaryVisit.create({
                ...input(),
                recordedByAccountId: null as unknown as RecordedByAccountId,
            }),
        ).toThrow(TypeError);
        expect(() =>
            PetVeterinaryVisit.reconstitute({
                ...input(),
                id: null as unknown as PetVeterinaryVisitId,
            }),
        ).toThrow(TypeError);
    });

    it.each([PetVeterinaryVisitId, PetId, RecordedByAccountId])(
        'validates and normalizes reference identities',
        (Identifier) => {
            const identifier: string = '550E8400-E29B-41D4-A716-446655440000';

            expect(Identifier.from(identifier).value).toBe(identifier.toLowerCase());

            for (const value of [
                'bad',
                '00000000-0000-0000-0000-000000000000',
                identifier + '\n',
            ]) {
                expect(() => Identifier.from(value)).toThrow(TypeError);
            }
        },
    );
});
