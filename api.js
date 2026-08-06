import { db } from "./firebase.js";
import {
    collection, doc, setDoc, deleteDoc, query, where, orderBy, onSnapshot, serverTimestamp, getDocs, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

export const API = {
    system: {
        listenToDepartments(callback) {
            const docRef = doc(db, "app_settings", "global_system");
            return onSnapshot(docRef, (docSnap) => {
                if (docSnap.exists() && docSnap.data().departments) callback(docSnap.data().departments);
                else callback(['التجميع النهائي']);
            });
            
        },
        async saveDepartments(departments) {
            const docRef = doc(db, "app_settings", "global_system");
            await setDoc(docRef, { departments: departments }, { merge: true });
        }
    },
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
            });
        }
    },
    master: {
        listenToAllProduction(date, shift, callback) {
            const q = query(collection(db, "production_records"), where("date", "==", date), where("shift", "==", shift));
            return onSnapshot(q, (snapshot) => callback(snapshot.docs.map(doc => doc.data())));
        },
        listenToAllTargets(date, shift, callback) {
            const q = query(collection(db, "shift_targets"), where("date", "==", date), where("shift", "==", shift));
            return onSnapshot(q, (snapshot) => callback(snapshot.docs.map(doc => doc.data())));
        },
        listenToAllScratches(date, callback) {
            const q = query(collection(db, "scratches_records"), where("date", "==", date));
            return onSnapshot(q, (snapshot) => callback(snapshot.docs.map(doc => doc.data())));
        }
    },
    production: {
        async testConnection() {
            try { const q = query(collection(db, "production_records"), limit(1)); await getDocs(q); return true; } 
            catch (error) { return false; }
        },
        async saveHour(department, record) {
            const docRef = doc(db, "production_records", record.recordId);
            await setDoc(docRef, { ...record, department: department, updatedAt: serverTimestamp() }, { merge: true });
        },
        async saveTarget(department, date, shift, targetVal) {
            const docRef = doc(db, "shift_targets", `${department}_${date}_${shift}`);
            await setDoc(docRef, { department: department, date: date, shift: shift, target: Number(targetVal), updatedAt: serverTimestamp() }, { merge: true });
        },
        listenToShift(department, date, shift, callback) {
            const q = query(collection(db, "production_records"), where("department", "==", department), where("date", "==", date), where("shift", "==", shift), orderBy("hour"));
            return onSnapshot(q, (snapshot) => callback(snapshot.docs.map(doc => doc.data())));
        },
        listenToTarget(department, date, shift, callback) {
            const docRef = doc(db, "shift_targets", `${department}_${date}_${shift}`);
            return onSnapshot(docRef, (docSnap) => {
                if (docSnap.exists()) callback(docSnap.data().target);
                else callback(0);
            });
        }
    },
    // ---------------- قسم الأرصدة (المتطور) ----------------
    balances: {
        async saveInventory(department, inventoryData) {
            const docRef = doc(db, "inventory_records", `${department}_inventory`);
            await setDoc(docRef, { ...inventoryData, updatedAt: serverTimestamp() }, { merge: true });
        },
        listenToInventory(department, callback) {
            const docRef = doc(db, "inventory_records", `${department}_inventory`);
            return onSnapshot(docRef, (docSnap) => {
                if (docSnap.exists()) callback(docSnap.data());
                else callback({ models: [], cabinet: {}, door: {} });
            });
        }
    },
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
            const q = query(collection(db, "scratches_records"), where("department", "==", department), where("date", "==", date), orderBy("id", "desc"));
            return onSnapshot(q, (snapshot) => callback(snapshot.docs.map(doc => doc.data())));
        }
    }
};
