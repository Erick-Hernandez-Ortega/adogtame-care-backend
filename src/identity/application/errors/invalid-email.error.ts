export class InvalidEmailError extends Error {
  constructor(cause: TypeError) {
    super(cause.message, { cause });
    this.name = 'InvalidEmailError';
  }
}
