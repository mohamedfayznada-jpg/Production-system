function isValidClockTime(value) {
    return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? ''));
}

export function createProductionRecord({ department, date, shift, hour, actual, shortfallReason }) {
    const normalizedDepartment = String(department ?? '').trim();
    const normalizedDate = String(date ?? '');
    const normalizedShift = String(shift ?? '');
    const normalizedHour = String(hour ?? '');
    const actualValue = actual === '' || actual === null || actual === undefined ? 0 : Number(actual);

    if (!normalizedDepartment) throw new RangeError('A department is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) throw new RangeError('A valid production date is required');
    if (!['1', '2'].includes(normalizedShift)) throw new RangeError('Shift must be 1 or 2');
    if (!isValidClockTime(normalizedHour)) throw new RangeError('A valid production hour is required');
    if (!Number.isSafeInteger(actualValue) || actualValue < 0) {
        throw new RangeError('Actual production must be a non-negative whole number');
    }

    const safeHour = normalizedHour.replace(':', '-');
    return {
        recordId: `${normalizedDepartment}_${normalizedDate}_${normalizedShift}_${safeHour}`,
        date: normalizedDate,
        shift: normalizedShift,
        hour: normalizedHour,
        actual: actualValue,
        shortfallReason: String(shortfallReason ?? '')
    };
}
