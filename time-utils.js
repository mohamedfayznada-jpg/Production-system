const DEFAULT_SHIFT_SETTINGS = Object.freeze({
    start: '07:30',
    end: '16:00',
    bStart: '12:30',
    bEnd: '13:30'
});

function toMinutes(value, fieldName) {
    const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(String(value ?? ''));
    if (!match) throw new RangeError(`Invalid ${fieldName} time: ${value}`);
    const [hours, minutes] = String(value).split(':').map(Number);
    return hours * 60 + minutes;
}

function toClockTime(absoluteMinutes) {
    const minutesOfDay = ((absoluteMinutes % 1440) + 1440) % 1440;
    const hours = Math.floor(minutesOfDay / 60);
    const minutes = minutesOfDay % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatArabicTime(clockTime) {
    let [hours, minutes] = clockTime.split(':').map(Number);
    const period = hours >= 12 ? 'م' : 'ص';
    hours = hours % 12 || 12;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${period}`;
}

/**
 * Build hourly production intervals using monotonically increasing minutes.
 * This avoids infinite loops when a shift crosses midnight.
 */
export function generateProductionIntervals(settings = {}) {
    const config = { ...DEFAULT_SHIFT_SETTINGS, ...(settings || {}) };
    const start = toMinutes(config.start, 'start');
    let end = toMinutes(config.end, 'end');
    if (end <= start) end += 1440;

    const breakStartClock = toMinutes(config.bStart, 'break start');
    const breakEndClock = toMinutes(config.bEnd, 'break end');
    const breakStart = breakStartClock < start ? breakStartClock + 1440 : breakStartClock;
    const breakDayOffset = Math.floor(breakStart / 1440) * 1440;
    let breakEnd = breakEndClock + breakDayOffset;
    if (breakEnd <= breakStart) breakEnd += 1440;

    const hasBreak = breakStart >= start && breakStart < end;
    const intervals = [];
    let current = start;

    while (current < end) {
        if (hasBreak && current === breakStart) {
            intervals.push({ isBreak: true, label: 'فترة راحة' });
            current = Math.min(breakEnd, end);
            continue;
        }

        let next = Math.min(current + 60, end);
        if (hasBreak && breakStart > current && breakStart < next) {
            next = breakStart;
        }
        if (next <= current) {
            throw new RangeError('Production interval generation did not advance');
        }

        const rawTime = toClockTime(next);
        intervals.push({ isBreak: false, label: formatArabicTime(rawTime), rawTime });
        current = next;
    }

    return intervals;
}
