import { VaccineName } from './vaccine-name';

describe('VaccineName', () => {
  it('trims exterior whitespace and preserves casing', () => {
    expect(VaccineName.from('  Rabies  ').value).toBe('Rabies');
    expect(VaccineName.from('rabies').value).toBe('rabies');
  });

  it('accepts 255 Unicode characters and rejects 256', () => {
    expect(VaccineName.from('🐕'.repeat(255)).value).toBe('🐕'.repeat(255));
    expect(() => VaccineName.from('🐕'.repeat(256))).toThrow(RangeError);
  });

  it.each(['', ' \t\n '])('rejects an empty name %j', (value) => {
    expect(() => VaccineName.from(value)).toThrow(TypeError);
  });
});
