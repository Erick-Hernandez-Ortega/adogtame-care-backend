import { AppliedDate } from '../applied-date/applied-date';
import { NextDueDate } from '../next-due-date/next-due-date';
import { VaccineName } from '../vaccine-name/vaccine-name';
import {
  PetId,
  RecordedByAccountId,
  VaccinationRecord,
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
    },
  );
});
