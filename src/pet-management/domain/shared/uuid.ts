import { randomUUID } from 'node:crypto';

const CANONICAL_UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID: string = '00000000-0000-0000-0000-000000000000';

export function generateUuid(): string {
  return randomUUID();
}

export function isValidUuid(value: string): boolean {
  return CANONICAL_UUID_PATTERN.test(value) && value.toLowerCase() !== NIL_UUID;
}
