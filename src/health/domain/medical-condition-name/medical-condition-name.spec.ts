import { MedicalConditionName } from './medical-condition-name';

describe('MedicalConditionName', () => {
  it('trims whitespace and preserves casing', () => {
    expect(MedicalConditionName.from('  Chronic kidney disease  ').value).toBe(
      'Chronic kidney disease',
    );
  });
  it('counts Unicode code points at the limit', () => {
    expect(MedicalConditionName.from('🐕'.repeat(255)).value).toBe(
      '🐕'.repeat(255),
    );
    expect(() => MedicalConditionName.from('🐕'.repeat(256))).toThrow(
      RangeError,
    );
  });
  it.each(['', ' ', '\t\n', 'x'.repeat(256)])(
    'rejects invalid name %s',
    (value: string) => {
      expect(() => MedicalConditionName.from(value)).toThrow();
    },
  );
  it.each([null, undefined, 1, {}, []])(
    'rejects non-string runtime input %s',
    (value: unknown) => {
      expect(() => MedicalConditionName.from(value as string)).toThrow(
        TypeError,
      );
    },
  );
});
