import type { WeightHistoryPosition } from '../persistence/weight-history.reader';

interface WeightHistoryCursor extends WeightHistoryPosition {
    readonly v: 1;
    readonly petId: string;
}

const uuidPattern: RegExp =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const datePattern: RegExp = /^\d{4}-\d{2}-\d{2}$/;
const timestampPattern: RegExp = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})\.(\d{6})Z$/;
const base64UrlPattern: RegExp = /^[A-Za-z0-9_-]+$/;

export class InvalidWeightHistoryCursorError extends Error {
    constructor() {
        super('Cursor is invalid');
    }
}

function isValidDate(value: string): boolean {
    if (!datePattern.test(value)) {
        return false;
    }

    const parsed: Date = new Date(`${value}T00:00:00.000Z`);

    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidTimestamp(value: string): boolean {
    const match: RegExpMatchArray | null = value.match(timestampPattern);

    if (match === null || !isValidDate(match[1])) {
        return false;
    }

    const milliseconds: string = match[3].slice(0, 3);
    const comparable: string = `${match[1]}T${match[2]}.${milliseconds}Z`;
    const parsed: Date = new Date(comparable);

    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === comparable;
}

function isCursor(value: unknown, petId: string): value is WeightHistoryCursor {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const fields: Record<string, unknown> = value as Record<string, unknown>;
    const keys: string[] = Object.keys(fields);

    return (
        keys.length === 5 &&
        keys.every((key: string): boolean =>
            ['v', 'petId', 'measuredDate', 'createdAt', 'id'].includes(key),
        ) &&
        fields.v === 1 &&
        fields.petId === petId &&
        typeof fields.petId === 'string' &&
        uuidPattern.test(fields.petId) &&
        typeof fields.measuredDate === 'string' &&
        isValidDate(fields.measuredDate) &&
        typeof fields.createdAt === 'string' &&
        isValidTimestamp(fields.createdAt) &&
        typeof fields.id === 'string' &&
        uuidPattern.test(fields.id)
    );
}

export function decodeWeightHistoryCursor(token: string, petId: string): WeightHistoryPosition {
    if (token.length === 0 || token.length > 512 || !base64UrlPattern.test(token)) {
        throw new InvalidWeightHistoryCursorError();
    }

    const bytes: Buffer = Buffer.from(token, 'base64url');

    if (bytes.toString('base64url') !== token) {
        throw new InvalidWeightHistoryCursorError();
    }

    let decoded: unknown;

    try {
        decoded = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
        throw new InvalidWeightHistoryCursorError();
    }

    if (!isCursor(decoded, petId)) {
        throw new InvalidWeightHistoryCursorError();
    }

    return {
        measuredDate: decoded.measuredDate,
        createdAt: decoded.createdAt,
        id: decoded.id,
    };
}

export function encodeWeightHistoryCursor(petId: string, position: WeightHistoryPosition): string {
    const cursor: WeightHistoryCursor = {
        v: 1,
        petId,
        measuredDate: position.measuredDate,
        createdAt: position.createdAt,
        id: position.id,
    };

    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
