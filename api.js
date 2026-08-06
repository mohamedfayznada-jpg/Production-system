import { db } from "./firebase.js";
import {
    collection, doc, setDoc, deleteDoc, query, where, orderBy, onSnapshot, serverTimestamp, getDocs, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

export const API = {
    // ---------------- قسم إدارة النظام والأقسام ----------------
    system: {
        listenToDepartments(callback) {
            const docRef = doc(db, "app_settings", "global_system");
            return onSnapshot(docRef, (docSnap) => {
                if (docSnap.exists() && docSnap.data().departments) {
                    callback(docSnap.data().departments);
                } else {
                    callback(['التجميع النهائي']);
                }
            });
        },
        async saveDepartments(departments) {
            const docRef = doc(db, "app_settings", "global_system");
            await setDoc(docRef, { departments: departments }, { merge: true });
        }
    },

    // ---------------- قسم الإعدادات لكل قسم ----------------
    settings: {
        async saveSettings(department, settingsData) {
            const docRef = doc(db, "app_settings", `dept_${department}`);
            await setDoc(docRef, { ...settingsData, updatedAt: serverTimestamp() }, { merge: true });
        },
        listenToSettings(department, callback) {
            const docRef = doc(db, "app_settings", `dept_${department}`);
            return onSnapshot(docRef, (docSnap) => {
                if (docSnap.exists()) callback(docSnap.data());
                else callback(null);
            }, (error) => console.error("Settings Error:", error));
        }
    },

    // ---------------- قسم اللوحة المجمعة (Master Dashboard) ----------------
    master: {
        listenToAllProduction(date, shift, callback) {
            const q = query(
                collection(db, "production_records"),
                where("date", "==", date),
                where("shift", "==", shift)
            );
            return onSnapshot(q, (snapshot) => {
                const records = snapshot.docs.map(doc => doc.data());
                callback(records);
            });
        }
    },

    // ---------------- قسم الإنتاج المعزول ----------------
    production: {
        async testConnection() {
            try {
                const q = query(collection(db, "production_records"), limit(1));
                await getDocs(q);
                return true;
            } catch (error) { return false; }
        },
        async saveHour(department, record) {
            const docRef = doc(db, "production_records", record.recordId);
            await setDoc(docRef, { ...record, department: department, updatedAt: serverTimestamp() }, { merge: true });
        },
        listenToShift(department, date, shift, callback) {
            const q = query(
                collection(db, "production_records"),
                where("department", "==", department),
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

    // ---------------- قسم الأرصدة (جديد) ----------------
    balances: {
        async saveBalance(department, type, balanceData) {
            const docRef = doc(db, "balances_records", `${department}_${type}`);
            await setDoc(docRef, {
                ...balanceData,
                department: department,
                type: type,
                updatedAt: serverTimestamp()
            }, { merge: true });
        },
        listenToBalances(department, callback) {
            const q = query(
                collection(db, "balances_records"),
                where("department", "==", department)
            );
            return onSnapshot(q, (snapshot) => {
                const records = snapshot.docs.map(doc => doc.data());
                callback(records);
            });
        }
    },

    // ---------------- قسم الجودة ----------------
    quality: {
        async saveDefect(department, defect) {
            const docRef = doc(db, "scratches_records", defect.id.toString());
            await setDoc(docRef, { ...defect, department: department, updatedAt: serverTimestamp() }, { merge: true });
        },
        async deleteDefect(id) {
            const docRef = doc(db, "scratches_records", id.toString());
            await deleteDoc(docRef);
        },
        listenToDefects(department, date, callback) {
            const q = query(
                collection(db, "scratches_records"),
                where("department", "==", department),
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
