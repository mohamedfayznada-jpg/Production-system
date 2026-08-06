import { db } from "./firebase.js";
import {
    collection,
    doc,
    setDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

export const API = {
    production: {
        async saveHour(record) {
            const docRef = doc(db, "production_records", record.recordId);
            await setDoc(docRef, {
                recordId: record.recordId,
                date: record.date,
                shift: record.shift,
                hour: record.hour,
                actual: record.actual,
                shortfallReason: record.shortfallReason,
                updatedAt: serverTimestamp()
            }, { merge: true });
        },

        listenToShift(date, shift, callback) {
            const q = query(
                collection(db, "production_records"),
                where("date", "==", date),
                where("shift", "==", shift),
                orderBy("hour")
            );

            return onSnapshot(q, (snapshot) => {
                const records = snapshot.docs.map(doc => doc.data());
                callback(records);
            }, (error) => {
                console.error("Real-time Listener Error:", error);
            });
        }
    }
};
