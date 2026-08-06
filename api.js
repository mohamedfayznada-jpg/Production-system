import { db } from "./firebase.js";
import {
    collection,
    doc,
    setDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    serverTimestamp,
    getDocs,
    limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

export const API = {
    // ---------------- قسم الإعدادات العامة (جديد) ----------------
    settings: {
        async saveSettings(settingsData) {
            const docRef = doc(db, "app_settings", "global_config");
            await setDoc(docRef, {
                ...settingsData,
                updatedAt: serverTimestamp()
            }, { merge: true });
        },

        listenToSettings(callback) {
            const docRef = doc(db, "app_settings", "global_config");
            return onSnapshot(docRef, (docSnap) => {
                if (docSnap.exists()) {
                    callback(docSnap.data());
                } else {
                    callback(null);
                }
            }, (error) => {
                console.error("Settings Listener Error:", error);
            });
        }
    },

    // ---------------- قسم الإنتاج ----------------
    production: {
        async testConnection() {
            try {
                const q = query(collection(db, "production_records"), limit(1));
                await getDocs(q);
                return true;
            } catch (error) {
                console.error("Firebase Connection Error:", error);
                return false;
            }
        },

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
            });
        }
    },

    // ---------------- قسم الجودة (عيوب الرش) ----------------
    quality: {
        async saveDefect(defect) {
            const docRef = doc(db, "scratches_records", defect.id.toString());
            await setDoc(docRef, {
                ...defect,
                updatedAt: serverTimestamp()
            }, { merge: true });
        },

        async deleteDefect(id) {
            const docRef = doc(db, "scratches_records", id.toString());
            await deleteDoc(docRef);
        },

        listenToDefects(date, callback) {
            const q = query(
                collection(db, "scratches_records"),
                where("date", "==", date),
                orderBy("id", "desc")
            );
            return onSnapshot(q, (snapshot) => {
                const records = snapshot.docs.map(doc => doc.data());
                callback(records);
            });
        }
    }
};
