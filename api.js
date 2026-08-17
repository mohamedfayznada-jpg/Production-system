import { db, storage } from "./firebase.js";
import {
    collection, doc, setDoc, deleteDoc, query, where, orderBy, onSnapshot, serverTimestamp, getDocs, getDoc, writeBatch, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

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
        },
        async renameDepartment(oldName, newName, departments) {
            if (!oldName || !newName || oldName === newName) throw new Error('invalid_department_rename');

            const operations = [];
            const queueSet = (ref, data, options = {}) => operations.push({ type: 'set', ref, data, options });
            const queueDelete = (ref) => operations.push({ type: 'delete', ref });
            const nextProductionId = (data, fallbackId) => {
                if (data.date && data.shift && data.hour) return `${newName}_${data.date}_${data.shift}_${data.hour}`;
                return fallbackId;
            };

            const productionSnap = await getDocs(query(collection(db, 'production_records'), where('department', '==', oldName)));
            productionSnap.forEach((recordDoc) => {
                const data = recordDoc.data();
                const newId = nextProductionId(data, recordDoc.id);
                queueSet(doc(db, 'production_records', newId), { ...data, department: newName, recordId: newId });
                if (newId !== recordDoc.id) queueDelete(recordDoc.ref);
            });

            const targetSnap = await getDocs(query(collection(db, 'shift_targets'), where('department', '==', oldName)));
            targetSnap.forEach((targetDoc) => {
                const data = targetDoc.data();
                const newId = data.date && data.shift ? `${newName}_${data.date}_${data.shift}` : targetDoc.id;
                queueSet(doc(db, 'shift_targets', newId), { ...data, department: newName });
                if (newId !== targetDoc.id) queueDelete(targetDoc.ref);
            });

            const defectSnap = await getDocs(query(collection(db, 'scratches_records'), where('department', '==', oldName)));
            defectSnap.forEach((defectDoc) => queueSet(defectDoc.ref, { ...defectDoc.data(), department: newName }, { merge: true }));

            const noteSnap = await getDocs(query(collection(db, '5s_notes'), where('department', '==', oldName)));
            noteSnap.forEach((noteDoc) => queueSet(noteDoc.ref, { ...noteDoc.data(), department: newName }, { merge: true }));

            const oldSettingsRef = doc(db, 'app_settings', `dept_${oldName}`);
            const oldSettingsSnap = await getDoc(oldSettingsRef);
            if (oldSettingsSnap.exists()) {
                queueSet(doc(db, 'app_settings', `dept_${newName}`), { ...oldSettingsSnap.data(), lineName: newName }, { merge: true });
                queueDelete(oldSettingsRef);
            }

            const summariesSnap = await getDocs(collection(db, '5s_monthly_summaries'));
            for (const summaryDoc of summariesSnap.docs) {
                const data = summaryDoc.data();
                if (Array.isArray(data.locations)) {
                    let changed = false;
                    const locations = data.locations.map((location) => {
                        if (location && location.department === oldName) {
                            changed = true;
                            return { ...location, department: newName };
                        }
                        return location;
                    });
                    if (changed) queueSet(summaryDoc.ref, { locations }, { merge: true });
                }

                const locationSnap = await getDocs(query(
                    collection(db, '5s_monthly_summaries', summaryDoc.id, 'locations'),
                    where('department', '==', oldName)
                ));
                locationSnap.forEach((locationDoc) => queueSet(locationDoc.ref, { ...locationDoc.data(), department: newName }, { merge: true }));
            }

            queueSet(doc(db, 'app_settings', 'global_system'), { departments }, { merge: true });

            for (let start = 0; start < operations.length; start += 450) {
                const batch = writeBatch(db);
                operations.slice(start, start + 450).forEach((operation) => {
                    if (operation.type === 'delete') batch.delete(operation.ref);
                    else batch.set(operation.ref, operation.data, operation.options);
                });
                await batch.commit();
            }
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
    // تم جعل الأرصدة تعمل على مستوى المصنع ككل (Global)
    balances: {
        async saveInventory(inventoryData) {
            const docRef = doc(db, "inventory_records", `factory_global_inventory`);
            await setDoc(docRef, { ...inventoryData, updatedAt: serverTimestamp() }, { merge: true });
        },
        listenToInventory(callback) {
            const docRef = doc(db, "inventory_records", `factory_global_inventory`);
            return onSnapshot(docRef, (docSnap) => {
                if (docSnap.exists()) callback(docSnap.data());
                else callback({ models: [], cabinet: {}, door: {} });
            });
        }
    },
    // تم تعديل نظام العيوب ليجلب عيوب اليوم + العيوب القديمة التي لا تزال تحت الإصلاح
    fiveS: {
        listenToLocations(callback) {
            const docRef = doc(db, "5s_settings", "locations");
            return onSnapshot(docRef, (docSnap) => {
                const locations = docSnap.exists() && Array.isArray(docSnap.data().locations) ? docSnap.data().locations : [];
                callback(locations);
            });
        },
        async saveLocations(locations) {
            const docRef = doc(db, "5s_settings", "locations");
            await setDoc(docRef, { locations, updatedAt: serverTimestamp() }, { merge: true });
        },
        listenToNotes(date, callback) {
            const q = query(collection(db, "5s_notes"), where("date", "==", date));
            return onSnapshot(q, (snapshot) => {
                callback(snapshot.docs.map((noteDoc) => ({ id: noteDoc.id, ...noteDoc.data() })));
            });
        },
        async saveNote(note) {
            const docRef = doc(db, "5s_notes", note.id);
            await setDoc(docRef, { ...note, updatedAt: serverTimestamp() }, { merge: true });
        },
        async deleteNote(noteId) {
            if (!noteId) throw new Error('missing_5s_note_id');
            const docRef = doc(db, "5s_notes", noteId);
            await deleteDoc(docRef);
        },
        async uploadImage(file, storagePath) {
            const storageRef = ref(storage, storagePath);
            await uploadBytes(storageRef, file, { contentType: file.type || "image/webp", cacheControl: "public,max-age=31536000" });
            return { path: storagePath, url: await getDownloadURL(storageRef) };
        },
        listenToMonthlySummaries(callback) {
            return onSnapshot(collection(db, "5s_monthly_summaries"), (snapshot) => {
                callback(snapshot.docs.map((summaryDoc) => ({ id: summaryDoc.id, ...summaryDoc.data() })));
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
            const qToday = query(collection(db, "scratches_records"), where("department", "==", department), where("date", "==", date));
            const qPending = query(collection(db, "scratches_records"), where("department", "==", department), where("status", "==", "pending"));

            let todayRecords = [];
            let pendingRecords = [];

            const mergeData = () => {
                const map = new Map();
                todayRecords.forEach(r => map.set(r.id, r));
                pendingRecords.forEach(r => map.set(r.id, r));
                callback(Array.from(map.values()).sort((a, b) => b.id - a.id));
            };

            const unsubToday = onSnapshot(qToday, (snap) => { todayRecords = snap.docs.map(d => d.data()); mergeData(); });
            const unsubPending = onSnapshot(qPending, (snap) => { pendingRecords = snap.docs.map(d => d.data()); mergeData(); });

            return () => { unsubToday(); unsubPending(); };
        }
    }
};
