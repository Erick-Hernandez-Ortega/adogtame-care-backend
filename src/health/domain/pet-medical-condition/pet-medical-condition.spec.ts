import { DiagnosedDate } from '../diagnosed-date/diagnosed-date';
import { MedicalConditionName } from '../medical-condition-name/medical-condition-name';
import {
  InvalidMedicalConditionNotesValueError,
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
    expect(PetMedicalCondition.create(input()).id.value).not.toBe(
      condition.id.value,
    );
    expect(condition.petId.value).toBe(petId);
    expect(condition.name.value).toBe('Epilepsy');
    expect(condition.diagnosedDate?.value).toBe('2026-03-14');
    expect(condition.recordedByAccountId.value).toBe(accountId);
    expect(condition.status).toBe(MedicalConditionStatus.ACTIVE);
    expect(
      PetMedicalConditionId.from(condition.id.value.toUpperCase()).value,
    ).toBe(condition.id.value);
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
    expect(
      PetMedicalCondition.create({ ...input(), notes: '🐕'.repeat(2000) })
        .notes,
    ).toBe('🐕'.repeat(2000));
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
    expect(RecordedByAccountId.from(accountId.toUpperCase()).value).toBe(
      accountId,
    );
  });
});
