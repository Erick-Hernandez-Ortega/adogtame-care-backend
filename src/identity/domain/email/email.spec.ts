import { Email } from './email';

describe('Email', () => {
  it('normalizes exterior whitespace and casing', () => {
    const email: Email = Email.from('  Erick@Example.COM  ');

    expect(email.value).toBe('erick@example.com');
  });

  it.each(['', '   '])('rejects an empty email: %p', (value: string) => {
    expect(() => Email.from(value)).toThrow('Email cannot be empty');
  });

  it.each([
    'erick',
    '@example.com',
    'erick@',
    'erick@@example.com',
    'erick @example.com',
    'erick@example .com',
  ])('rejects an invalid email format: %s', (value: string) => {
    expect(() => Email.from(value)).toThrow('Email format is invalid');
  });

  it('accepts a non-empty local part and domain without requiring a dot', () => {
    expect(Email.from('account@localhost').value).toBe('account@localhost');
  });
});
