import { db, storage, auth, adminProvisioningAuth } from "./firebase.js";
import {
    collection, doc, setDoc, deleteDoc, query, where, orderBy, onSnapshot, serverTimestamp, getDocs, getDoc, writeBatch, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

const USER_EMAIL_DOMAIN = 'production-b0b2c.firebaseapp.com';
const MASTER_USERNAME = 'mfayez';
const MASTER_PASSWORD_HASH = 'd20fdf0c14354aad8439e23de3b404b66c5327cd60065e5db896caf55673630e';
const defaultPermissions = () => ({
    view: { production: true, quality: true, balances: true, fiveS: true, analytics: true, settings: true },
    edit: { production: true, quality: true, balances: true, fiveS: true, settings: true }
});
const usernameEmail = (username) => `${String(username || '').trim().toLowerCase()}@${USER_EMAIL_DOMAIN}`;

export const API = {
    auth: {
        onAuthStateChanged(callback) { return onAuthStateChanged(auth, callback); },
        async login(username, password) {
            const normalized = String(username || '').trim().toLowerCase();
            if (!/^[a-z0-9._-]{3,40}$/.test(normalized)) throw new Error('invalid_username');
            if (!password) throw new Error('missing_password');

            let credential;
            try {
                credential = await signInWithEmailAndPassword(auth, usernameEmail(normalized), password);
            } catch (error) {
                const isMasterAttempt = normalized === MASTER_USERNAME && await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password)).then(buffer => Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, '0')).join('')) === MASTER_PASSWORD_HASH;
                if (!isMasterAttempt || !['auth/user-not-found', 'auth/invalid-credential'].includes(error.code)) throw error;
                credential = await createUserWithEmailAndPassword(auth, usernameEmail(normalized), password);
            }

            const profileRef = doc(db, 'app_users', credential.user.uid);
            const profileSnap = await getDoc(profileRef);
            const profile = profileSnap.exists() ? profileSnap.data() : null;
            if (!profile && normalized === MASTER_USERNAME) {
                const masterProfile = {
                    uid: credential.user.uid,
                    username: MASTER_USERNAME,
                    usernameLower: MASTER_USERNAME,
                    role: 'admin',
                    jobTitle: 'مدير النظام',
                    active: true,
                    allowedDepartments: ['*'],
                    permissions: defaultPermissions(),
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                };
                await setDoc(profileRef, masterProfile, { merge: true });
                return { uid: credential.user.uid, ...masterProfile, isMaster: true };
            }
            if (!profile || profile.active === false) {
                await signOut(auth);
                throw new Error('account_not_configured');
            }
            return { uid: credential.user.uid, ...profile, isMaster: profile.role === 'admin' && profile.usernameLower === MASTER_USERNAME };
        },
        async requestPasswordReset(username) {
            const normalized = String(username || '').trim().toLowerCase();
            if (!/^[a-z0-9._-]{3,40}$/.test(normalized)) throw new Error('invalid_username');
            await sendPasswordResetEmail(auth, usernameEmail(normalized));
        },
        async logout() { await signOut(auth); },
        async getProfile(uid) {
            const snap = await getDoc(doc(db, 'app_users', uid));
            return snap.exists() ? { uid, ...snap.data() } : null;
        },
        listenToUsers(callback) {
            return onSnapshot(collection(db, 'app_users'), (snapshot) => {
                const users = snapshot.docs.map(userDoc => ({ uid: userDoc.id, ...userDoc.data() }));
                callback(users.sort((a, b) => String(a.username || '').localeCompare(String(b.username || ''), 'ar')));
            });
        },
        async createUser({ username, password, role, jobTitle, allowedDepartments, permissions }) {
            const normalized = String(username || '').trim().toLowerCase();
            if (!/^[a-z0-9._-]{3,40}$/.test(normalized)) throw new Error('invalid_username');
            if (!password || password.length < 6) throw new Error('weak_password');
            const existing = await getDocs(query(collection(db, 'app_users'), where('usernameLower', '==', normalized), limit(1)));
            if (!existing.empty) throw new Error('username_exists');
            const credential = await createUserWithEmailAndPassword(adminProvisioningAuth, usernameEmail(normalized), password);
            const profile = {
                uid: credential.user.uid,
                username: normalized,
                usernameLower: normalized,
                role: role || 'technician',
                jobTitle: jobTitle || 'فني',
                active: true,
                allowedDepartments: Array.isArray(allowedDepartments) && allowedDepartments.length ? allowedDepartments : ['*'],
                permissions: permissions || { view: {}, edit: {} },
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };
            await setDoc(doc(db, 'app_users', credential.user.uid), profile);
            await signOut(adminProvisioningAuth);
            return profile;
        },
        async updateUser(uid, changes) {
            await setDoc(doc(db, 'app_users', uid), { ...changes, updatedAt: serverTimestamp() }, { merge: true });
        },
        async deactivateUser(uid) {
            await setDoc(doc(db, 'app_users', uid), { active: false, updatedAt: serverTimestamp() }, { merge: true });
        }
    },
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
        },
        listenToScopedProduction(departments, date, shift, callback) {
            const scope = [...new Set((departments || []).filter(Boolean))];
            if (!scope.length) { callback([]); return () => {}; }
            const filters = [where("date", "==", date), where("shift", "==", shift)];
            if (!scope.includes('*')) filters.push(where("department", "in", scope.slice(0, 30)));
            const q = query(collection(db, "production_records"), ...filters);
            return onSnapshot(q, (snapshot) => callback(snapshot.docs.map(doc => doc.data())));
        },
        listenToScopedTargets(departments, date, shift, callback) {
            const scope = [...new Set((departments || []).filter(Boolean))];
            if (!scope.length) { callback([]); return () => {}; }
            const filters = [where("date", "==", date), where("shift", "==", shift)];
            if (!scope.includes('*')) filters.push(where("department", "in", scope.slice(0, 30)));
            const q = query(collection(db, "shift_targets"), ...filters);
            return onSnapshot(q, (snapshot) => callback(snapshot.docs.map(doc => doc.data())));
        },
        listenToScopedScratches(departments, date, callback) {
            const scope = [...new Set((departments || []).filter(Boolean))];
            if (!scope.length) { callback([]); return () => {}; }
            const filters = [where("date", "==", date)];
            if (!scope.includes('*')) filters.push(where("department", "in", scope.slice(0, 30)));
            const q = query(collection(db, "scratches_records"), ...filters);
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
