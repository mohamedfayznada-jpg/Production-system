import { db, storage } from "./firebase.js";
import {
    collection, doc, setDoc, deleteDoc, query, where, orderBy, onSnapshot, serverTimestamp, getDocs, limit, writeBatch
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
        async uploadImage(file, storagePath, googleApiUrl) {
            if (!file || !googleApiUrl) throw new Error('missing_drive_upload_configuration');
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('image_read_error'));
                reader.readAsDataURL(file);
            });
            const pathParts = String(storagePath || '').split('/').filter(Boolean);
            const date = pathParts[1] || new Date().toISOString().slice(0, 10);
            const payload = {
                type: 'IMAGE_UPLOAD',
                payload: {
                    filename: `5S_${date}_${pathParts[2] || Date.now()}_${pathParts[3] || 'image'}.webp`,
                    mimeType: file.type || 'image/webp',
                    base64: dataUrl,
                    date,
                    folderPath: `5S/${date.slice(0, 7)}/${date}`,
                    source: '5S'
                }
            };
            const response = await fetch(googleApiUrl, {
                method: 'POST',
                redirect: 'follow',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });
            const raw = await response.text();
            let result;
            try { result = JSON.parse(raw); } catch (error) { throw new Error('invalid_drive_response'); }
            if (!response.ok || result.status !== 'success' || !(result.url || result.webViewLink || result.downloadUrl)) {
                throw new Error(result.message || 'drive_upload_failed');
            }
            return {
                path: result.path || storagePath,
                url: result.url || result.webViewLink || result.downloadUrl,
                driveFileId: result.fileId || result.id || ''
            };
        },
        async archivePreviousMonths(currentMonthKey) {
            const oldQuery = query(collection(db, '5s_notes'), where('monthKey', '<', currentMonthKey));
            const snapshot = await getDocs(oldQuery);
            if (snapshot.empty) return { archivedMonths: 0, archivedNotes: 0 };

            const grouped = new Map();
            snapshot.docs.forEach((noteDoc) => {
                const note = noteDoc.data();
                const monthKey = note.monthKey || String(note.date || '').slice(0, 7);
                if (!monthKey || monthKey >= currentMonthKey) return;
                const key = `${monthKey}|||${note.department || 'غير محدد'}|||${note.place || 'غير محدد'}`;
                const current = grouped.get(key) || {
                    monthKey,
                    department: note.department || 'غير محدد',
                    place: note.place || 'غير محدد',
                    totalNotes: 0,
                    correctiveNotes: 0
                };
                current.totalNotes += 1;
                if (note.correctiveImagePath || note.correctiveImageUrl) current.correctiveNotes += 1;
                grouped.set(key, current);
            });

            const locationsByMonth = new Map();
            const totalsByMonth = new Map();
            grouped.forEach((item) => {
                const location = {
                    department: item.department,
                    place: item.place,
                    totalNotes: item.totalNotes,
                    correctiveNotes: item.correctiveNotes,
                    completionRate: item.totalNotes ? Math.round((item.correctiveNotes / item.totalNotes) * 100) : 0
                };
                if (!locationsByMonth.has(item.monthKey)) locationsByMonth.set(item.monthKey, []);
                locationsByMonth.get(item.monthKey).push(location);
                const totals = totalsByMonth.get(item.monthKey) || { totalNotes: 0, correctiveNotes: 0 };
                totals.totalNotes += item.totalNotes;
                totals.correctiveNotes += item.correctiveNotes;
                totalsByMonth.set(item.monthKey, totals);
            });

            for (const [monthKey, totals] of totalsByMonth.entries()) {
                const summaryRef = doc(db, '5s_monthly_summaries', monthKey);
                await setDoc(summaryRef, {
                    monthKey,
                    totalNotes: totals.totalNotes,
                    correctiveNotes: totals.correctiveNotes,
                    completionRate: totals.totalNotes ? Math.round((totals.correctiveNotes / totals.totalNotes) * 100) : 0,
                    locations: locationsByMonth.get(monthKey) || [],
                    archivedAtClient: new Date().toISOString(),
                    imageStorage: 'google_drive'
                }, { merge: true });
            }

            const docs = snapshot.docs.filter((noteDoc) => {
                const note = noteDoc.data();
                const monthKey = note.monthKey || String(note.date || '').slice(0, 7);
                return monthKey && monthKey < currentMonthKey;
            });
            for (let index = 0; index < docs.length; index += 450) {
                const batch = writeBatch(db);
                docs.slice(index, index + 450).forEach((noteDoc) => batch.delete(noteDoc.ref));
                await batch.commit();
            }
            return { archivedMonths: totalsByMonth.size, archivedNotes: docs.length };
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
