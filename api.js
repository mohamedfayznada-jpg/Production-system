import { db } from "./firebase.js";

import {
    collection,
    addDoc,
    getDocs,
    query,
    where,
    orderBy,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

export const API = {

    production: {

      async saveHour(record) {

    return await addDoc(
        collection(db, "production_records"),
        {
            recordId: `${record.date}_${record.shift}_${record.hour}`,
            date: record.date,
            shift: record.shift,
            hour: record.hour,
            model: record.model,
            plan: record.plan,
            actual: record.actual,
            isBreak: record.isBreak,
            shortfallReason: record.shortfallReason,
            target: record.target,
            device: navigator.userAgent,
            updatedAt: serverTimestamp()
        }
    );

},

        async get(date, shift) {

            const q = query(
                collection(db, "production_records"),
                where("date", "==", date),
                where("shift", "==", shift),
                orderBy("hour")
            );

            const snap = await getDocs(q);

            return snap.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

        },

    }

};

window.API = API;
