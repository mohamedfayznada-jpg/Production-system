import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// مفاتيح الربط الصحيحة لمشروع production-b0b2c
const firebaseConfig = {
    apiKey: "AIzaSyC4GyboQgeYdNxwDyxkEowpXTsAT-CMFyg",
    authDomain: "production-b0b2c.firebaseapp.com",
    databaseURL: "https://production-b0b2c-default-rtdb.firebaseio.com",
    projectId: "production-b0b2c",
    storageBucket: "production-b0b2c.firebasestorage.app",
    messagingSenderId: "628405148231",
    appId: "1:628405148231:web:e277a8422324e358aaef62",
    measurementId: "G-5KP3JMH9EZ"
};

// تهيئة التطبيق
const app = initializeApp(firebaseConfig);

// تهيئة قاعدة البيانات للاتصال المباشر
const db = getFirestore(app);

export { db };
