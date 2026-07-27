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

        },

    }

};

window.API = API;
