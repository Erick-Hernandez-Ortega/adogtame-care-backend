export const HEALTH_CLOCK: unique symbol = Symbol('HEALTH_CLOCK');

export interface Clock {
  now(): Date;
}
