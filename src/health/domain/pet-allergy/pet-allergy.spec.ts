import { Allergen } from '../allergen/allergen';
import {
  PetAllergy,
  PetAllergyId,
  PetId,
  RecordedByAccountId,
  AllergyCategory,
  AllergySeverity,
  InvalidAllergenValueError,
  InvalidAllergyCategoryValueError,
  InvalidAllergySeverityValueError,
  InvalidAllergyNotesValueError,
} from './pet-allergy';

const petId: string = 'b30a4c42-84e5-4765-99d4-1efb17f09c12';
const accountId: string = '550e8400-e29b-41d4-a716-446655440000';
function input() {
  return {
    petId: PetId.from(petId),
    allergen: Allergen.from('Chicken'),
    category: 'FOOD',
    severity: 'UNKNOWN',
    recordedByAccountId: RecordedByAccountId.from(accountId),
  };
}
describe('PetAllergy', () => {
  it('generates independent UUID v4 identities and preserves references', () => {
    const allergy: PetAllergy = PetAllergy.create(input());
    expect(allergy.id.value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(PetAllergy.create(input()).id.value).not.toBe(allergy.id.value);
    expect(allergy.petId.value).toBe(petId);
    expect(allergy.recordedByAccountId.value).toBe(accountId);
    expect(allergy.allergen.value).toBe('Chicken');
    expect(PetAllergyId.from(allergy.id.value.toUpperCase()).value).toBe(
      allergy.id.value,
    );
  });
  it.each(Object.values(AllergyCategory))(
    'accepts category %s',
    (category: AllergyCategory) => {
      expect(PetAllergy.create({ ...input(), category }).category).toBe(
        category,
      );
    },
  );
  it.each(Object.values(AllergySeverity))(
    'accepts severity %s',
    (severity: AllergySeverity) => {
      expect(PetAllergy.create({ ...input(), severity }).severity).toBe(
        severity,
      );
    },
  );
  it.each(['food', ' FOOD ', '', 'UNKNOWN'])(
    'rejects category %s',
    (category: string) => {
      expect(() => PetAllergy.create({ ...input(), category })).toThrow(
        InvalidAllergyCategoryValueError,
      );
    },
  );
  it.each(['unknown', ' UNKNOWN ', '', 'CRITICAL'])(
    'rejects severity %s',
    (severity: string) => {
      expect(() => PetAllergy.create({ ...input(), severity })).toThrow(
        InvalidAllergySeverityValueError,
      );
    },
  );
  it.each([undefined, null])(
    'normalizes absent notes %s to null',
    (notes: undefined | null) => {
      expect(PetAllergy.create({ ...input(), notes }).notes).toBeNull();
    },
  );
  it('trims notes and accepts the exact Unicode character limit', () => {
    expect(
      PetAllergy.create({ ...input(), notes: '  Reported reaction. \n' }).notes,
    ).toBe('Reported reaction.');
    expect(
      PetAllergy.create({ ...input(), notes: '🐕'.repeat(2000) }).notes,
    ).toBe('🐕'.repeat(2000));
  });
  it.each(['', ' \n', 'x'.repeat(2001), '🐕'.repeat(2001)])(
    'rejects invalid notes',
    (notes: string) => {
      expect(() => PetAllergy.create({ ...input(), notes })).toThrow(
        InvalidAllergyNotesValueError,
      );
    },
  );
  it('rejects invalid runtime data', () => {
    expect(() =>
      PetAllergy.create({ ...input(), notes: 3 as unknown as string }),
    ).toThrow(InvalidAllergyNotesValueError);
    expect(() =>
      PetAllergy.create({
        ...input(),
        allergen: 'Chicken' as unknown as Allergen,
      }),
    ).toThrow(TypeError);
    expect(() =>
      PetAllergy.create({ ...input(), category: null as unknown as string }),
    ).toThrow(InvalidAllergyCategoryValueError);
    expect(() =>
      PetAllergy.create({ ...input(), severity: null as unknown as string }),
    ).toThrow(InvalidAllergySeverityValueError);
  });
  it.each(['bad', '00000000-0000-0000-0000-000000000000'])(
    'rejects invalid reference identities %s',
    (value: string) => {
      expect(() => PetId.from(value)).toThrow(TypeError);
      expect(() => RecordedByAccountId.from(value)).toThrow(TypeError);
      expect(() => PetAllergyId.from(value)).toThrow(TypeError);
    },
  );
});

describe('PetAllergy correction', () => {
  function current(): PetAllergy {
    return PetAllergy.create({ ...input(), notes: 'Original notes' });
  }
  it('reconstitutes the same persistent identity without generating a new one', () => {
    const allergy: PetAllergy = current();
    const restored: PetAllergy = PetAllergy.reconstitute({ ...allergy });
    expect(restored).toEqual(allergy);
    expect(() =>
      PetAllergy.reconstitute({
        ...allergy,
        id: 'bad' as unknown as PetAllergyId,
      }),
    ).toThrow(TypeError);
    expect(() =>
      PetAllergy.reconstitute({ ...allergy, category: 'bad' }),
    ).toThrow(InvalidAllergyCategoryValueError);
  });
  it.each([
    [{ allergen: '  Penicillin  ' }, { allergen: Allergen.from('Penicillin') }],
    [{ category: 'OTHER' }, { category: 'OTHER' }],
    [{ severity: 'SEVERE' }, { severity: 'SEVERE' }],
    [{ notes: '  Corrected notes  ' }, { notes: 'Corrected notes' }],
    [{ notes: null }, { notes: null }],
    [
      { allergen: '🐕'.repeat(255), notes: '🐕'.repeat(2000) },
      { allergen: Allergen.from('🐕'.repeat(255)), notes: '🐕'.repeat(2000) },
    ],
    [
      {
        allergen: 'Penicillin',
        category: 'MEDICATION',
        severity: 'MODERATE',
        notes: null,
      },
      {
        allergen: Allergen.from('Penicillin'),
        category: 'MEDICATION',
        severity: 'MODERATE',
        notes: null,
      },
    ],
  ])(
    'corrects %j while preserving all omitted data and identity',
    (patch, expected) => {
      const allergy: PetAllergy = current();
      const before: PetAllergy = PetAllergy.reconstitute({ ...allergy });
      const corrected: PetAllergy = allergy.correct(patch);
      expect(corrected).toEqual({ ...allergy, ...expected });
      expect(allergy).toEqual(before);
      expect(corrected.id.value).toBe(allergy.id.value);
      expect(corrected.petId.value).toBe(allergy.petId.value);
      expect(corrected.recordedByAccountId.value).toBe(
        allergy.recordedByAccountId.value,
      );
    },
  );
  it.each([
    [{ allergen: '' }, InvalidAllergenValueError],
    [{ allergen: ' ' }, InvalidAllergenValueError],
    [{ allergen: '🐕'.repeat(256) }, InvalidAllergenValueError],
    [{ allergen: null as unknown as string }, InvalidAllergenValueError],
    [{ category: ' FOOD ' }, InvalidAllergyCategoryValueError],
    [{ category: null as unknown as string }, InvalidAllergyCategoryValueError],
    [{ severity: 'critical' }, InvalidAllergySeverityValueError],
    [{ severity: null as unknown as string }, InvalidAllergySeverityValueError],
    [{ notes: ' ' }, InvalidAllergyNotesValueError],
    [{ notes: '🐕'.repeat(2001) }, InvalidAllergyNotesValueError],
    [{ notes: 1 as unknown as string }, InvalidAllergyNotesValueError],
    [
      { allergen: 'Penicillin', category: 'MEDICATION', notes: '' },
      InvalidAllergyNotesValueError,
    ],
    [{}, TypeError],
  ])(
    'rejects invalid correction %j without mutating the original',
    (patch, errorClass) => {
      const allergy: PetAllergy = current();
      const before: PetAllergy = PetAllergy.reconstitute({ ...allergy });
      expect(() => allergy.correct(patch)).toThrow(errorClass);
      expect(allergy).toEqual(before);
    },
  );
  it('returns the original instance for normalized no-ops', () => {
    const allergy: PetAllergy = current();
    for (const patch of [
      { allergen: '  Chicken  ' },
      { category: 'FOOD' },
      { severity: 'UNKNOWN' },
      { notes: '  Original notes  ' },
      {
        allergen: 'Chicken',
        category: 'FOOD',
        severity: 'UNKNOWN',
        notes: 'Original notes',
      },
    ]) {
      expect(allergy.correct(patch)).toBe(allergy);
    }
    const withoutNotes: PetAllergy = allergy.correct({ notes: null });
    expect(withoutNotes.correct({ notes: null })).toBe(withoutNotes);
  });
});
