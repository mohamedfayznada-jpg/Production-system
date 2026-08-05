import { db } from "./firebase.js";
import {
    collection,
    doc,
    setDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

export const API = {
    production: {
        // حفظ أو تحديث سجل ساعة معينة
        async saveHour(record) {
            try {
                // نستخدم setDoc مع merge لإنشاء السجل أو تحديثه إذا كان موجوداً
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
                return true;
            } catch (error) {
                console.error("Error saving hour:", error);
                throw error;
            }
        },

        // الاستماع المباشر (Real-time) لتغييرات الوردية الحالية
        listenToShift(date, shift, callback) {
            const q = query(
                collection(db, "production_records"),
                where("date", "==", date),
                where("shift", "==", shift),
                orderBy("hour")
            );

            // onSnapshot تقوم بتنفيذ الـ callback تلقائياً عند أي تغيير في الأجهزة الأخرى
            return onSnapshot(q, (snapshot) => {
                const records = snapshot.docs.map(doc => doc.data());
                callback(records);
            }, (error) => {
                console.error("Real-time listener error:", error);
            });
        }
    }
};
