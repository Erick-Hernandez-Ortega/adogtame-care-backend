export class InvalidPasswordError extends Error {
  constructor() {
    super('Password must be between 12 and 128 characters');
    this.name = 'InvalidPasswordError';
  }
}

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super('Email is already registered');
    this.name = 'EmailAlreadyRegisteredError';
  }
}
