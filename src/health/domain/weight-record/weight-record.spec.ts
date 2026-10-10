import { MeasuredDate } from '../measured-date/measured-date';
import { Weight } from '../weight/weight';
import { PetId, RecordedByAccountId, WeightRecord, WeightRecordId } from './weight-record';

const PET_ID = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('WeightRecord', () => {
    it('creates a distinct UUID v4 and preserves functional identities', () => {
        const petId = PetId.from(PET_ID);
        const recordedByAccountId = RecordedByAccountId.from(ACCOUNT_ID);
        const weight = Weight.fromKilograms('12.3456');
        const measuredDate = MeasuredDate.from('2026-09-26', '2026-09-26');
        const record = WeightRecord.create({
            petId,
            weight,
            measuredDate,
            recordedByAccountId,
        });

        expect(record.id.value).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(record.petId).toBe(petId);
        expect(record.weight).toBe(weight);
        expect(record.measuredDate).toBe(measuredDate);
        expect(record.recordedByAccountId).toBe(recordedByAccountId);
        expect(
            WeightRecord.create({ petId, weight, measuredDate, recordedByAccountId }).id.value,
        ).not.toBe(record.id.value);
    });

    it.each(['not-a-uuid', '00000000-0000-0000-0000-000000000000'])(
        'rejects invalid identity %s',
        (id) => {
            expect(() => PetId.from(id)).toThrow(TypeError);
            expect(() => RecordedByAccountId.from(id)).toThrow(TypeError);
            expect(() => WeightRecordId.from(id)).toThrow(TypeError);
        },
    );

    it('reconstitutes and corrects values while retaining identity and authorship', () => {
        const record = WeightRecord.reconstitute({
            id: WeightRecordId.from('68f9d91f-cbcd-4da7-b1b8-1ee61a0bb321'),
            petId: PetId.from(PET_ID),
            weight: Weight.fromKilograms('12.34'),
            measuredDate: MeasuredDate.from('2026-09-25', '2026-09-26'),
            recordedByAccountId: RecordedByAccountId.from(ACCOUNT_ID),
        });
        const corrected = record.correct({
            weight: Weight.fromKilograms('0013.5000'),
            measuredDate: MeasuredDate.from('2026-09-26', '2026-09-26'),
        });

        expect(corrected).not.toBe(record);
        expect(corrected).toMatchObject({
            id: record.id,
            petId: record.petId,
            recordedByAccountId: record.recordedByAccountId,
        });
        expect(corrected.weight.kilograms).toBe('13.5');
        expect(corrected.measuredDate.value).toBe('2026-09-26');
        expect(record.weight.kilograms).toBe('12.34');
        expect(record.correct({ weight: Weight.fromKilograms('012.3400') })).toBe(record);
        expect(
            record.correct({
                measuredDate: MeasuredDate.from('2026-09-25', '2026-09-26'),
            }),
        ).toBe(record);
    });
});
