import { ActivityNotes } from './activity-notes';

describe('ActivityNotes', () => {
    it('trims and counts Unicode code points', () => {
        expect(ActivityNotes.from('  Done  ').value).toBe('Done');
        expect(ActivityNotes.from('🐕'.repeat(2000)).value).toBe('🐕'.repeat(2000));
        expect(() => ActivityNotes.from('🐕'.repeat(2001))).toThrow(RangeError);
        expect(() => ActivityNotes.from(' ')).toThrow(TypeError);
    });
});
