import type { Account } from '../../domain/account/account';

export const ACCOUNT_REPOSITORY: unique symbol = Symbol('ACCOUNT_REPOSITORY');

export const SaveAccountOutcome = {
  SAVED: 'SAVED',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
} as const;

export type SaveAccountOutcome =
  (typeof SaveAccountOutcome)[keyof typeof SaveAccountOutcome];

export interface AccountRepository {
  save(account: Account): Promise<SaveAccountOutcome>;
}
