import test from 'node:test';
import assert from 'node:assert/strict';
import { generateProductionIntervals } from '../time-utils.js';

test('generates normal day shift intervals and a break', () => {
    const intervals = generateProductionIntervals({
        start: '07:30', end: '16:00', bStart: '12:30', bEnd: '13:30'
    });
    assert.deepEqual(intervals.map((item) => item.isBreak ? 'break' : item.rawTime), [
        '08:30', '09:30', '10:30', '11:30', '12:30', 'break', '14:30', '15:30', '16:00'
    ]);
});

test('generates a shift ending at midnight without looping', () => {
    const intervals = generateProductionIntervals({
        start: '16:05', end: '00:00', bStart: '12:30', bEnd: '13:30'
    });
    assert.deepEqual(intervals.map((item) => item.rawTime), [
        '17:05', '18:05', '19:05', '20:05', '21:05', '22:05', '23:05', '00:00'
    ]);
    assert.equal(intervals.some((item) => item.isBreak), false);
});

test('handles a break in the after-midnight portion of an overnight shift', () => {
    const intervals = generateProductionIntervals({
        start: '22:00', end: '06:00', bStart: '01:00', bEnd: '01:30'
    });
    assert.deepEqual(intervals.map((item) => item.isBreak ? 'break' : item.rawTime), [
        '23:00', '00:00', '01:00', 'break', '02:30', '03:30', '04:30', '05:30', '06:00'
    ]);
});

test('rejects invalid configured times instead of risking a non-advancing loop', () => {
    assert.throws(() => generateProductionIntervals({
        start: '25:00', end: '06:00', bStart: '01:00', bEnd: '01:30'
    }), RangeError);
});
