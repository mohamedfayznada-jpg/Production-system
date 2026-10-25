import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionRecord } from '../production-utils.js';

test('creates a stable production record from captured context', () => {
    assert.deepEqual(createProductionRecord({
        department: 'التجميع النهائى',
        date: '2026-10-25',
        shift: '2',
        hour: '23:05',
        actual: '42',
        shortfallReason: 'نقص أبواب'
    }), {
        recordId: 'التجميع النهائى_2026-10-25_2_23-05',
        date: '2026-10-25',
        shift: '2',
        hour: '23:05',
        actual: 42,
        shortfallReason: 'نقص أبواب'
    });
});

test('normalizes an empty production quantity to zero', () => {
    assert.equal(createProductionRecord({
        department: 'A', date: '2026-10-25', shift: '1', hour: '08:30', actual: ''
    }).actual, 0);
});

test('rejects negative, fractional, or non-numeric production quantities', () => {
    for (const actual of [-1, 1.5, 'abc']) {
        assert.throws(() => createProductionRecord({
            department: 'A', date: '2026-10-25', shift: '1', hour: '08:30', actual
        }), RangeError);
    }
});

test('rejects invalid production context', () => {
    assert.throws(() => createProductionRecord({
        department: '', date: '2026-10-25', shift: '1', hour: '08:30', actual: 10
    }), RangeError);
    assert.throws(() => createProductionRecord({
        department: 'A', date: '2026-10-25', shift: '3', hour: '08:30', actual: 10
    }), RangeError);
    assert.throws(() => createProductionRecord({
        department: 'A', date: '2026-10-25', shift: '1', hour: '25:00', actual: 10
    }), RangeError);
});
