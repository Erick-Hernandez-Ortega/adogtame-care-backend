import { InvalidPasswordError } from './register-account.errors';

const MINIMUM_PASSWORD_LENGTH: number = 12;
const MAXIMUM_PASSWORD_LENGTH: number = 128;

export function assertPasswordMeetsPolicy(password: string): void {
  const passwordLength: number = Array.from(password).length;

  if (
    passwordLength < MINIMUM_PASSWORD_LENGTH ||
    passwordLength > MAXIMUM_PASSWORD_LENGTH
  ) {
    throw new InvalidPasswordError();
  }
}
