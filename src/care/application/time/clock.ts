export const CARE_CLOCK: unique symbol = Symbol('CARE_CLOCK');

export interface Clock {
    now(): Date;
}
