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
async saveTest() {

    return await this.save({

        recordId: crypto.randomUUID(),

        date: "2026-07-26",

        shift: 1,

        hour: "08:30",

        model: "TEST",

        plan: 10,

        actual: 10,

        user: "Mohamed",

        device: navigator.userAgent

    });

}
        async save(record) {

            return await addDoc(
                collection(db, "production_records"),
                {
                    ...record,
                    createdAt: serverTimestamp()
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

        }

    }

};
window.API = API;
