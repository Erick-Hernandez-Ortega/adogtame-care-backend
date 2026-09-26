export const CLOCK: unique symbol = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}
