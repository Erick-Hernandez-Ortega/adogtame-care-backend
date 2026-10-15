import { RoutineTimezone } from './routine-timezone';

describe('RoutineTimezone', () => {
    it.each(['UTC', 'America/Mexico_City', 'America/New_York', 'Asia/Kathmandu'])(
        'accepts IANA timezone %s independently of the current date',
        (value: string) => {
            expect(RoutineTimezone.from(value).value).toBe(
                new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone,
            );
        },
    );

    it('canonicalizes aliases', () => {
        expect(RoutineTimezone.from('Etc/UTC').value).toBe('UTC');
    });

    it.each(['', ' ', ' UTC', 'UTC\n', '+01:00', '-06:00', 'Mars/Olympus', null, undefined, 6])(
        'rejects invalid timezone %s',
        (value: unknown) => {
            expect(() => RoutineTimezone.from(value as string)).toThrow(TypeError);
        },
    );
});
