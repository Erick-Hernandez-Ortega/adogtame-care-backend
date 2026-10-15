import { VisitDate } from '../visit-date/visit-date';
import { VeterinaryVisitReason } from '../veterinary-visit-reason/veterinary-visit-reason';
import {
    PetVeterinaryVisit,
    PetId,
    RecordedByAccountId,
    InvalidVeterinaryVisitDateValueError,
    InvalidVeterinaryVisitReasonValueError,
    InvalidVeterinaryVisitDiagnosisValueError,
    InvalidVeterinaryVisitObservationsValueError,
} from './pet-veterinary-visit';

function visit(): PetVeterinaryVisit {
    return PetVeterinaryVisit.create({
        petId: PetId.from('550e8400-e29b-41d4-a716-446655440001'),
        recordedByAccountId: RecordedByAccountId.from('550e8400-e29b-41d4-a716-446655440002'),
        visitDate: VisitDate.reconstitute('2026-02-10'),
        reason: VeterinaryVisitReason.from('Checkup'),
        diagnosis: 'Healthy',
        observations: 'Routine examination',
    });
}

const today: string = '2026-03-14';

describe('PetVeterinaryVisit correction', () => {
    it('corrects and normalizes all fields while preserving identity and authorship', () => {
        const original: PetVeterinaryVisit = visit();
        const corrected: PetVeterinaryVisit = original.correct(
            {
                reason: ' Follow-up ',
                visitDate: today,
                diagnosis: ' Updated diagnosis ',
                observations: ' Updated observations ',
            },
            today,
        );

        expect(corrected).not.toBe(original);
        expect(corrected.id).toBe(original.id);
        expect(corrected.petId).toBe(original.petId);
        expect(corrected.recordedByAccountId).toBe(original.recordedByAccountId);
        expect(corrected.reason.value).toBe('Follow-up');
        expect(corrected.visitDate.value).toBe(today);
        expect(corrected.diagnosis).toBe('Updated diagnosis');
        expect(corrected.observations).toBe('Updated observations');
        expect(original.reason.value).toBe('Checkup');
    });

    it.each([
        { reason: ' Checkup ' },
        { visitDate: '2026-02-10' },
        { diagnosis: ' Healthy ' },
        { observations: ' Routine examination ' },
    ])('returns the same instance for normalized no-op %j', (patch) => {
        const original: PetVeterinaryVisit = visit();

        expect(original.correct(patch, today)).toBe(original);
    });

    it('preserves omitted fields, clears optional fields and makes clearing idempotent', () => {
        const original: PetVeterinaryVisit = visit();
        const corrected: PetVeterinaryVisit = original.correct(
            { diagnosis: null, observations: null },
            today,
        );

        expect(corrected.reason).toBe(original.reason);
        expect(corrected.visitDate).toBe(original.visitDate);
        expect(corrected.diagnosis).toBeNull();
        expect(corrected.observations).toBeNull();
        expect(corrected.correct({ diagnosis: null, observations: null }, today)).toBe(corrected);
    });

    it('rejects an empty correction', () => {
        expect(() => visit().correct({}, today)).toThrow(TypeError);
    });

    it.each([
        [{ reason: '' }, InvalidVeterinaryVisitReasonValueError],
        [{ reason: ' ' }, InvalidVeterinaryVisitReasonValueError],
        [{ reason: '🐕'.repeat(256) }, InvalidVeterinaryVisitReasonValueError],
        [{ visitDate: '2026-02-29' }, InvalidVeterinaryVisitDateValueError],
        [{ visitDate: '2026-03-15' }, InvalidVeterinaryVisitDateValueError],
        [{ visitDate: '0000-01-01' }, InvalidVeterinaryVisitDateValueError],
        [{ visitDate: '2026' }, InvalidVeterinaryVisitDateValueError],
        [{ diagnosis: '' }, InvalidVeterinaryVisitDiagnosisValueError],
        [{ diagnosis: '🐕'.repeat(2001) }, InvalidVeterinaryVisitDiagnosisValueError],
        [{ observations: ' ' }, InvalidVeterinaryVisitObservationsValueError],
        [{ observations: '🐕'.repeat(5001) }, InvalidVeterinaryVisitObservationsValueError],
    ])('rejects invalid correction %j without mutating the original', (patch, errorClass) => {
        const original: PetVeterinaryVisit = visit();

        expect(() => original.correct(patch, today)).toThrow(errorClass);
        expect(original.reason.value).toBe('Checkup');
        expect(original.diagnosis).toBe('Healthy');
    });

    it('accepts Unicode code point limits and civil dates at the supported boundaries', () => {
        const corrected: PetVeterinaryVisit = visit().correct(
            {
                reason: '🐕'.repeat(255),
                diagnosis: '🐕'.repeat(2000),
                observations: '🐕'.repeat(5000),
                visitDate: '0001-01-01',
            },
            today,
        );

        expect(corrected.visitDate.value).toBe('0001-01-01');
        expect(corrected.correct({ visitDate: '9999-12-31' }, '9999-12-31').visitDate.value).toBe(
            '9999-12-31',
        );
    });

    it('preserves historical dates when omitted but validates explicit equal dates against today', () => {
        const original: PetVeterinaryVisit = visit();

        expect(original.correct({ reason: ' Checkup ' }, '2020-01-01')).toBe(original);
        expect(() => original.correct({ visitDate: '2026-02-10' }, '2020-01-01')).toThrow(
            InvalidVeterinaryVisitDateValueError,
        );
    });
});
