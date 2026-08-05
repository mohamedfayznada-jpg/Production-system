import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDwiSlMnznYKza8WTRX2CkRHvZZV_CE64A",
    authDomain: "mes-core-v27.firebaseapp.com",
    projectId: "mes-core-v27",
    storageBucket: "mes-core-v27.firebasestorage.app",
    messagingSenderId: "745936325795",
    appId: "1:745936325795:web:09f5915cb116dbd3be0316"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// تفعيل العمل دون إنترنت
enableIndexedDbPersistence(db).catch((err) => {
    console.error("Firebase Offline Persistence Error:", err);
});

export { db };
