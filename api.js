import { db } from "./firebase.js";
import {
    collection,
    doc,
    setDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    serverTimestamp,
    getDocs,
    limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

export const API = {
    production: {
        // اختبار الاتصال الفعلي بقاعدة البيانات
        async testConnection() {
            try {
                const q = query(collection(db, "production_records"), limit(1));
                await getDocs(q);
                return true; // متصل
            } catch (error) {
                console.error("Firebase Connection Error:", error);
                return false; // غير متصل أو لا توجد صلاحيات
            }
        },

        // حفظ البيانات مع إجبار السيرفر على الرد
        async saveHour(record) {
            const docRef = doc(db, "production_records", record.recordId);
            // عملية الكتابة ستفشل فوراً وتظهر خطأ إذا لم يكن هناك اتصال حقيقي
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

        // الاستماع المباشر للتغييرات
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
            }, (error) => {
                console.error("Real-time Listener Error:", error);
            });
        }
    }
};
