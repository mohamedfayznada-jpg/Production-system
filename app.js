import { API } from './api.js';

const App = {
    currentListenerUnsubscribe: null,
    
    // الهيكل الأساسي لوردية العمل (يمكن تطويره لاحقاً ليأتي من الإعدادات)
    shiftHours: [
        { hour: "08:00", label: "08:00 ص" },
        { hour: "09:00", label: "09:00 ص" },
        { hour: "10:00", label: "10:00 ص" },
        { hour: "11:00", label: "11:00 ص" },
        { hour: "12:00", label: "12:00 م" },
        { hour: "13:00", label: "01:00 م" },
        { hour: "14:00", label: "02:00 م" },
        { hour: "15:00", label: "03:00 م" },
        { hour: "16:00", label: "04:00 م" }
    ],

    init() {
        // تعيين تاريخ اليوم والوردية الافتراضية
        const today = new Date();
        const dateString = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        
        document.getElementById('global-date').value = dateString;
        document.getElementById('global-shift').value = "1";

        // إضافة مستمعات الأحداث (Event Listeners) لتغيير التاريخ أو الوردية
        document.getElementById('global-date').addEventListener('change', () => this.loadCurrentShift());
        document.getElementById('global-shift').addEventListener('change', () => this.loadCurrentShift());

        // بناء الواجهة وبدء الاستماع لقاعدة البيانات
        this.buildProductionUI();
        this.loadCurrentShift();
    },

    // بناء حقول الإدخال في الشاشة بناءً على المصفوفة
    buildProductionUI() {
        const container = document.getElementById('production-list');
        container.innerHTML = '';

        this.shiftHours.forEach(timeSlot => {
            const html = `
                <div class="hour-row" data-hour="${timeSlot.hour}">
                    <div class="hour-header">
                        <span class="time-label">${timeSlot.label}</span>
                        <input type="number" class="actual-input" placeholder="0" 
                            onchange="App.handleInputChange('${timeSlot.hour}')">
                    </div>
                    <input type="text" class="reason-input" placeholder="سبب العجز (إن وجد)..." 
                        onchange="App.handleInputChange('${timeSlot.hour}')">
                </div>
            `;
            container.innerHTML += html;
        });
    },

    // تحميل بيانات الوردية وبدء المزامنة اللحظية
    loadCurrentShift() {
        const date = document.getElementById('global-date').value;
        const shift = document.getElementById('global-shift').value;

        // إيقاف المستمع القديم إذا تم تغيير التاريخ/الوردية
        if (this.currentListenerUnsubscribe) {
            this.currentListenerUnsubscribe();
        }

        // مسح الشاشة الحالية قبل جلب البيانات الجديدة
        this.clearInputs();

        // الاستماع المباشر من Firebase
        this.currentListenerUnsubscribe = API.production.listenToShift(date, shift, (records) => {
            this.updateUIFromCloud(records);
        });
    },

    // مسح الحقول 
    clearInputs() {
        document.querySelectorAll('.actual-input').forEach(input => input.value = '');
        document.querySelectorAll('.reason-input').forEach(input => input.value = '');
        document.getElementById('live-total').innerText = '0';
    },

    // تحديث الشاشة بناءً على البيانات القادمة من السحابة (من الأجهزة الأخرى أو الجهاز الحالي)
    updateUIFromCloud(records) {
        let total = 0;

        records.forEach(record => {
            const row = document.querySelector(`.hour-row[data-hour="${record.hour}"]`);
            if (row) {
                const actualInput = row.querySelector('.actual-input');
                const reasonInput = row.querySelector('.reason-input');
                
                // تحديث الحقول فقط إذا لم تكن قيد التعديل حالياً لتجنب تداخل الكتابة
                if (document.activeElement !== actualInput) {
                    actualInput.value = record.actual || '';
                }
                if (document.activeElement !== reasonInput) {
                    reasonInput.value = record.shortfallReason || '';
                }

                total += Number(record.actual) || 0;
            }
        });

        document.getElementById('live-total').innerText = total;
    },

    // معالجة تغيير المستخدم للبيانات في حقل معين وإرسالها للسحابة
    async handleInputChange(hourStr) {
        const date = document.getElementById('global-date').value;
        const shift = document.getElementById('global-shift').value;
        
        const row = document.querySelector(`.hour-row[data-hour="${hourStr}"]`);
        const actualVal = row.querySelector('.actual-input').value;
        const reasonVal = row.querySelector('.reason-input').value;

        const recordId = `${date}_${shift}_${hourStr}`;

        const payload = {
            recordId: recordId,
            date: date,
            shift: shift,
            hour: hourStr,
            actual: actualVal,
            shortfallReason: reasonVal
        };

        try {
            await API.production.saveHour(payload);
            this.showToast("تم مزامنة البيانات");
        } catch (error) {
            this.showToast("حدث خطأ في المزامنة");
        }
    },

    showToast(msg) {
        const toast = document.getElementById('toast');
        toast.innerText = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }
};

// ربط الكائن بنافذة المتصفح لتتمكن عناصر الـ HTML من استدعاء الدوال
window.App = App;

// بدء التطبيق عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
