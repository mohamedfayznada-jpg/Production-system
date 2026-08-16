const { logger } = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const storage = admin.storage();
const REGION = "europe-west1";
const TIME_ZONE = "Africa/Cairo";

function monthKeyFromDate(date) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit"
    }).format(date);
}

function safeDocumentId(value) {
    return String(value || "unknown").replace(/[\\/#?\\[\\]]/g, "_").slice(0, 120);
}

async function deleteStorageFile(filePath) {
    if (!filePath) return;
    try {
        await storage.bucket().file(filePath).delete({ ignoreNotFound: true });
    } catch (error) {
        logger.warn("5S image deletion failed", { filePath, error: error.message });
    }
}

exports.archive5SNotes = onSchedule({
    schedule: "15 0 1 * *",
    timeZone: TIME_ZONE,
    region: REGION,
    memory: "256MiB",
    timeoutSeconds: 540,
    retryCount: 3
}, async () => {
    const currentMonthKey = monthKeyFromDate(new Date());
    const snapshot = await db.collection("5s_notes")
        .where("monthKey", "<", currentMonthKey)
        .get();

    if (snapshot.empty) {
        logger.info("5S archive: no completed months found");
        return;
    }

    const summaries = new Map();
    const fileDeletes = [];
    const noteDeletes = [];

    snapshot.docs.forEach((noteDoc) => {
        const note = noteDoc.data();
        const monthKey = note.monthKey || String(note.date || "").slice(0, 7);
        if (!monthKey) return;
        const locationKey = `${monthKey}|||${note.department || "غير محدد"}|||${note.place || "غير محدد"}`;
        const current = summaries.get(locationKey) || {
            monthKey,
            department: note.department || "غير محدد",
            place: note.place || "غير محدد",
            totalNotes: 0,
            correctiveNotes: 0
        };
        current.totalNotes += 1;
        if (note.correctiveImagePath || note.correctiveImageUrl) current.correctiveNotes += 1;
        summaries.set(locationKey, current);

        fileDeletes.push(deleteStorageFile(note.observationImagePath));
        fileDeletes.push(deleteStorageFile(note.correctiveImagePath));
        noteDeletes.push(noteDoc.ref);
    });

    const batch = db.batch();
    const monthTotals = new Map();
    const locationsByMonth = new Map();
    summaries.forEach((summary) => {
        const locationId = safeDocumentId(`${summary.department}__${summary.place}`);
        const summaryRef = db.collection("5s_monthly_summaries")
            .doc(summary.monthKey)
            .collection("locations")
            .doc(locationId);
        batch.set(summaryRef, {
            monthKey: summary.monthKey,
            department: summary.department,
            place: summary.place,
            totalNotes: summary.totalNotes,
            correctiveNotes: summary.correctiveNotes,
            completionRate: summary.totalNotes ? Math.round((summary.correctiveNotes / summary.totalNotes) * 100) : 0,
            archivedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        const monthTotal = monthTotals.get(summary.monthKey) || { totalNotes: 0, correctiveNotes: 0 };
        monthTotal.totalNotes += summary.totalNotes;
        monthTotal.correctiveNotes += summary.correctiveNotes;
        monthTotals.set(summary.monthKey, monthTotal);
        if (!locationsByMonth.has(summary.monthKey)) locationsByMonth.set(summary.monthKey, []);
        locationsByMonth.get(summary.monthKey).push({
            department: summary.department,
            place: summary.place,
            totalNotes: summary.totalNotes,
            correctiveNotes: summary.correctiveNotes,
            completionRate: summary.totalNotes ? Math.round((summary.correctiveNotes / summary.totalNotes) * 100) : 0
        });
    });

    monthTotals.forEach((total, monthKey) => {
        batch.set(db.collection("5s_monthly_summaries").doc(monthKey), {
            monthKey,
            totalNotes: total.totalNotes,
            correctiveNotes: total.correctiveNotes,
            completionRate: total.totalNotes ? Math.round((total.correctiveNotes / total.totalNotes) * 100) : 0,
            locations: locationsByMonth.get(monthKey) || [],
            archivedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });

    noteDeletes.forEach((noteRef) => batch.delete(noteRef));
    await batch.commit();
    await Promise.all(fileDeletes);

    logger.info("5S archive completed", {
        archivedNotes: noteDeletes.length,
        archivedLocations: summaries.size,
        archivedMonths: monthTotals.size
    });
});
