import { AppliedDate } from '../applied-date/applied-date';
import { NextDueDate } from '../next-due-date/next-due-date';
import { VaccineName } from '../vaccine-name/vaccine-name';
import {
  PetId,
  RecordedByAccountId,
  VaccinationRecord,
  VaccinationRecordId,
  NextDueDateNotAfterAppliedDateError,
} from './vaccination-record';

describe('VaccinationRecord', () => {
  it('creates independent records with server IDs and reference identities', () => {
    const petId = PetId.from('b30a4c42-84e5-4765-99d4-1efb17f09c12');
    const recordedByAccountId = RecordedByAccountId.from(
      '550e8400-e29b-41d4-a716-446655440000',
    );
    const input = {
      petId,
      vaccineName: VaccineName.from('  Rabies '),
      appliedDate: AppliedDate.from('2026-09-20', '2026-09-27'),
      nextDueDate: NextDueDate.from('2027-09-20'),
      recordedByAccountId,
    };
    const first = VaccinationRecord.create(input);
    const second = VaccinationRecord.create(input);
    expect(first.id.value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.id.value).not.toBe(second.id.value);
    expect(first.petId).toBe(petId);
    expect(first.recordedByAccountId).toBe(recordedByAccountId);
    expect(first.vaccineName.value).toBe('Rabies');
    expect(
      VaccinationRecord.create({ ...input, nextDueDate: null }).nextDueDate,
    ).toBeNull();
  });

  it.each(['bad', '00000000-0000-0000-0000-000000000000'])(
    'rejects invalid reference ID %s',
    (value) => {
      expect(() => PetId.from(value)).toThrow(TypeError);
      expect(() => RecordedByAccountId.from(value)).toThrow(TypeError);
      expect(() => VaccinationRecordId.from(value)).toThrow(TypeError);
    },
  );

  function existing(): VaccinationRecord {
    return VaccinationRecord.reconstitute({
      id: VaccinationRecordId.from('6fe44a29-206e-4875-9f3e-72026868135e'),
      petId: PetId.from('b30a4c42-84e5-4765-99d4-1efb17f09c12'),
      vaccineName: VaccineName.from('Rabies'),
      appliedDate: AppliedDate.from('2026-01-01', '2026-09-27'),
      nextDueDate: NextDueDate.from('2027-01-01'),
      recordedByAccountId: RecordedByAccountId.from(
        '550e8400-e29b-41d4-a716-446655440000',
      ),
    });
  }

  it('corrects individual and combined values without changing identities or authorship', () => {
    const record: VaccinationRecord = existing();
    const name: VaccinationRecord = record.correct({
      vaccineName: VaccineName.from('  RaBiEs Booster  '),
    });
    expect(name.vaccineName.value).toBe('RaBiEs Booster');
    const applied: VaccinationRecord = name.correct({
      appliedDate: AppliedDate.from('2026-02-01', '2026-09-27'),
    });
    expect(applied.appliedDate.value).toBe('2026-02-01');
    const due: VaccinationRecord = applied.correct({
      nextDueDate: NextDueDate.from('2028-02-01'),
    });
    expect(due.nextDueDate?.value).toBe('2028-02-01');
    const replaced: VaccinationRecord = due.correct({
      nextDueDate: NextDueDate.from('2029-02-01'),
    });
    expect(replaced.nextDueDate?.value).toBe('2029-02-01');
    const cleared: VaccinationRecord = replaced.correct({ nextDueDate: null });
    expect(cleared.nextDueDate).toBeNull();
    const combined: VaccinationRecord = cleared.correct({
      vaccineName: VaccineName.from('Distemper'),
      appliedDate: AppliedDate.from('2025-03-01', '2026-09-27'),
      nextDueDate: NextDueDate.from('2026-03-01'),
    });
    expect(combined).toMatchObject({
      id: record.id,
      petId: record.petId,
      recordedByAccountId: record.recordedByAccountId,
    });
    expect(combined.vaccineName.value).toBe('Distemper');
    expect(combined.appliedDate.value).toBe('2025-03-01');
    expect(combined.nextDueDate?.value).toBe('2026-03-01');
    expect(record.vaccineName.value).toBe('Rabies');
  });

  it('returns the same record for normalized and null no-ops', () => {
    const record: VaccinationRecord = existing();
    expect(
      record.correct({ vaccineName: VaccineName.from('  Rabies  ') }),
    ).toBe(record);
    const withoutDueDate: VaccinationRecord = record.correct({
      nextDueDate: null,
    });
    expect(withoutDueDate.correct({ nextDueDate: null })).toBe(withoutDueDate);
  });

  it('validates the final dates, including an omitted due date', () => {
    const record: VaccinationRecord = existing();
    expect(() =>
      record.correct({
        appliedDate: AppliedDate.from('2026-09-20', '2026-09-27'),
        nextDueDate: NextDueDate.from('2026-09-19'),
      }),
    ).toThrow(NextDueDateNotAfterAppliedDateError);
    expect(() =>
      record.correct({
        nextDueDate: NextDueDate.from('2025-12-31'),
      }),
    ).toThrow(NextDueDateNotAfterAppliedDateError);
    expect(() =>
      record.correct({
        appliedDate: AppliedDate.from('2026-09-20', '2026-09-27'),
        nextDueDate: NextDueDate.from('2026-09-20'),
      }),
    ).toThrow(NextDueDateNotAfterAppliedDateError);
    const laterRecord: VaccinationRecord = record.correct({
      nextDueDate: NextDueDate.from('2026-03-01'),
    });
    expect(() =>
      laterRecord.correct({
        appliedDate: AppliedDate.from('2026-06-01', '2026-09-27'),
      }),
    ).toThrow(NextDueDateNotAfterAppliedDateError);
    expect(
      laterRecord.correct({
        appliedDate: AppliedDate.from('2026-06-01', '2026-09-27'),
        nextDueDate: NextDueDate.from('2027-06-01'),
      }).nextDueDate?.value,
    ).toBe('2027-06-01');
    expect(() => AppliedDate.from('2026-09-28', '2026-09-27')).toThrow(
      RangeError,
    );
  });
});
