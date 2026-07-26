import { db } from "./firebase.js";

import {
    collection,
    addDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

export const API = {

    async test() {

        await addDoc(collection(db, "system_test"), {

            status: "OK",

            createdAt: serverTimestamp()

        });

        console.log("✅ Firestore Write Success");

    }

};
