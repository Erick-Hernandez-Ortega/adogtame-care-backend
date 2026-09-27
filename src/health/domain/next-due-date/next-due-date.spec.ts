import { AppliedDate } from '../applied-date/applied-date';
import {
  PetId,
  RecordedByAccountId,
  VaccinationRecord,
} from '../vaccination-record/vaccination-record';
import { VaccineName } from '../vaccine-name/vaccine-name';
import { NextDueDate } from './next-due-date';

const petId = PetId.from('b30a4c42-84e5-4765-99d4-1efb17f09c12');
const recordedByAccountId = RecordedByAccountId.from(
  '550e8400-e29b-41d4-a716-446655440000',
);
const vaccineName = VaccineName.from('Rabies');

describe('NextDueDate', () => {
  it('accepts a past due date when it follows the applied date', () => {
    const appliedDate = AppliedDate.from('2024-01-10', '2026-09-27');
    const nextDueDate = NextDueDate.from('2025-01-10');
    const record = VaccinationRecord.create({
      petId,
      vaccineName,
      appliedDate,
      nextDueDate,
      recordedByAccountId,
    });
    expect(record.nextDueDate?.value).toBe('2025-01-10');
  });

  it.each(['2025-02-29', '2025-13-01', '2025-1-1'])(
    'rejects invalid date %s',
    (value) => {
      expect(() => NextDueDate.from(value)).toThrow();
    },
  );

  it.each(['2024-01-10', '2024-01-09'])(
    'rejects a date not after application %s',
    (value) => {
      const appliedDate = AppliedDate.from('2024-01-10', '2026-09-27');
      const nextDueDate = NextDueDate.from(value);
      expect(() =>
        VaccinationRecord.create({
          petId,
          vaccineName,
          appliedDate,
          nextDueDate,
          recordedByAccountId,
        }),
      ).toThrow('Next due date must be after applied date');
    },
  );
});
