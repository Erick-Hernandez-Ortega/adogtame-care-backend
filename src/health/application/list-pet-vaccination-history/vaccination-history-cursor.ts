import type { VaccinationHistoryPosition } from '../persistence/vaccination-history.reader';

interface VaccinationHistoryCursor extends VaccinationHistoryPosition {
    readonly v: 1;
    readonly petId: string;
}

const uuidPattern: RegExp =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const datePattern: RegExp = /^\d{4}-\d{2}-\d{2}$/;
const timestampPattern: RegExp = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})\.(\d{6})Z$/;
const base64UrlPattern: RegExp = /^[A-Za-z0-9_-]+$/;

export class InvalidVaccinationHistoryCursorError extends Error {
    constructor() {
        super('Cursor is invalid');
    }
}

function isValidDate(value: string): boolean {
    if (!datePattern.test(value)) {
        return false;
    }

    const year: number = Number(value.slice(0, 4));
    const month: number = Number(value.slice(5, 7));
    const day: number = Number(value.slice(8, 10));

    if (year < 1 || month < 1 || month > 12 || day < 1) {
        return false;
    }

    const isLeapYear: boolean = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
    const daysByMonth: readonly number[] = [
        31,
        isLeapYear ? 29 : 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];

    return day <= daysByMonth[month - 1];
}

function isValidTimestamp(value: string): boolean {
    const match: RegExpMatchArray | null = value.match(timestampPattern);

    if (match === null || !isValidDate(match[1])) {
        return false;
    }

    const hour: number = Number(match[2].slice(0, 2));
    const minute: number = Number(match[2].slice(3, 5));
    const second: number = Number(match[2].slice(6, 8));

    return hour < 24 && minute < 60 && second < 60;
}

function isCursor(value: unknown, petId: string): value is VaccinationHistoryCursor {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const fields: Record<string, unknown> = value as Record<string, unknown>;
    const keys: string[] = Object.keys(fields);

    return (
        keys.length === 5 &&
        keys.every((key: string): boolean =>
            ['v', 'petId', 'appliedDate', 'createdAt', 'id'].includes(key),
        ) &&
        fields.v === 1 &&
        fields.petId === petId &&
        typeof fields.petId === 'string' &&
        uuidPattern.test(fields.petId) &&
        typeof fields.appliedDate === 'string' &&
        isValidDate(fields.appliedDate) &&
        typeof fields.createdAt === 'string' &&
        isValidTimestamp(fields.createdAt) &&
        typeof fields.id === 'string' &&
        uuidPattern.test(fields.id)
    );
}

export function decodeVaccinationHistoryCursor(
    token: string,
    petId: string,
): VaccinationHistoryPosition {
    if (token.length === 0 || token.length > 512 || !base64UrlPattern.test(token)) {
        throw new InvalidVaccinationHistoryCursorError();
    }

    const bytes: Buffer = Buffer.from(token, 'base64url');

    if (bytes.toString('base64url') !== token) {
        throw new InvalidVaccinationHistoryCursorError();
    }

    let decoded: unknown;

    try {
        decoded = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
        throw new InvalidVaccinationHistoryCursorError();
    }

    if (!isCursor(decoded, petId)) {
        throw new InvalidVaccinationHistoryCursorError();
    }

    return {
        appliedDate: decoded.appliedDate,
        createdAt: decoded.createdAt,
        id: decoded.id,
    };
}

export function encodeVaccinationHistoryCursor(
    petId: string,
    position: VaccinationHistoryPosition,
): string {
    const cursor: VaccinationHistoryCursor = {
        v: 1,
        petId,
        appliedDate: position.appliedDate,
        createdAt: position.createdAt,
        id: position.id,
    };

    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
