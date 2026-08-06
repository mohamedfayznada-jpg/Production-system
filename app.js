import { API } from './api.js';

const App = {
    currentListenerUnsubscribe: null,
    isOnline: true,
    saveTimers: {}, // لتأخير الحفظ أثناء الكتابة (Debounce) لعدم إرهاق السيرفر
    
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

    async init() {
        this.updateConnectionStatus(true);

        const today = new Date();
        const dateString = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        
        document.getElementById('global-date').value = dateString;
        document.getElementById('global-shift').value = "1";

        document.getElementById('global-date').addEventListener('change', () => this.loadCurrentShift());
        document.getElementById('global-shift').addEventListener('change', () => this.loadCurrentShift());

        this.buildProductionUI();
        this.loadCurrentShift();
    },

    updateConnectionStatus(isOnline) {
        const dot = document.getElementById('connection-status');
        if(isOnline) {
            dot.className = 'status-dot online';
            dot.title = 'متصل بالسحابة';
        } else {
            dot.className = 'status-dot offline';
            dot.title = 'يتم المزامنة بالخلفية';
        }
    },

    buildProductionUI() {
        const container = document.getElementById('production-list');
        container.innerHTML = '';

        this.shiftHours.forEach(timeSlot => {
            // استخدام oninput ليعمل مع كل حرف يُكتب فوراً
            const html = `
                <div class="hour-row" id="row-${timeSlot.hour}" data-hour="${timeSlot.hour}">
                    <div class="hour-header">
                        <span class="time-label">${timeSlot.label}</span>
                        <input type="number" class="actual-input" placeholder="0" 
                            oninput="App.handleInputChange('${timeSlot.hour}')">
                    </div>
                    <input type="text" class="reason-input" placeholder="سبب العجز (إن وجد)..." 
                        oninput="App.handleInputChange('${timeSlot.hour}')">
                </div>
            `;
            container.innerHTML += html;
        });
    },

    loadCurrentShift() {
        const date = document.getElementById('global-date').value;
        const shift = document.getElementById('global-shift').value;

        if (this.currentListenerUnsubscribe) {
            this.currentListenerUnsubscribe();
        }

        this.clearInputs();

        // الاستماع المباشر من Firebase
        this.currentListenerUnsubscribe = API.production.listenToShift(date, shift, (records) => {
            this.updateUIFromCloud(records);
        });
    },

    clearInputs() {
        document.querySelectorAll('.actual-input').forEach(input => input.value = '');
        document.querySelectorAll('.reason-input').forEach(input => input.value = '');
        document.getElementById('live-total').innerText = '0';
    },

    updateUIFromCloud(records) {
        records.forEach(record => {
            const row = document.getElementById(`row-${record.hour}`);
            if (row) {
                const actualInput = row.querySelector('.actual-input');
                const reasonInput = row.querySelector('.reason-input');
                
                // لا نُحدث الحقل من السيرفر إذا كان المستخدم يقف عليه ويكتب بداخله الآن
                if (document.activeElement !== actualInput) {
                    actualInput.value = record.actual || '';
                }
                if (document.activeElement !== reasonInput) {
                    reasonInput.value = record.shortfallReason || '';
                }
            }
        });
        
        // تحديث الإجمالي بعد جلب البيانات
        this.calculateLocalTotal();
    },

    calculateLocalTotal() {
        let total = 0;
        document.querySelectorAll('.actual-input').forEach(input => {
            total += Number(input.value) || 0;
        });
        document.getElementById('live-total').innerText = total;
    },

    handleInputChange(hourStr) {
        // 1. تحديث إجمالي الشاشة فوراً عند الكتابة بدون انتظار السيرفر
        this.calculateLocalTotal();

        // 2. مسح المؤقت القديم إذا استمر المستخدم بالكتابة بسرعة
        if (this.saveTimers[hourStr]) {
            clearTimeout(this.saveTimers[hourStr]);
        }

        // 3. إنشاء مؤقت جديد ينتظر 700 ملي ثانية بعد آخر حرف يكتبه المستخدم ليرسل للسيرفر
        this.saveTimers[hourStr] = setTimeout(async () => {
            const date = document.getElementById('global-date').value;
            const shift = document.getElementById('global-shift').value;
            const row = document.getElementById(`row-${hourStr}`);
            
            const actualVal = row.querySelector('.actual-input').value;
            const reasonVal = row.querySelector('.reason-input').value;

            const payload = {
                recordId: `${date}_${shift}_${hourStr}`,
                date: date,
                shift: shift,
                hour: hourStr,
                actual: actualVal,
                shortfallReason: reasonVal
            };

            try {
                row.classList.add('saving'); // إظهار تأثير الحفظ
                await API.production.saveHour(payload);
                row.classList.remove('saving');
                this.updateConnectionStatus(true);
            } catch (error) {
                console.error(error);
                row.classList.remove('saving');
                this.updateConnectionStatus(false); // لم يتم الحفظ للسحابة (سيتم الحفظ محلياً بالكاش)
            }
        }, 700);
    },

    showToast(msg, isError = false) {
        const toast = document.getElementById('toast');
        toast.innerText = msg;
        toast.className = isError ? 'show error' : 'show';
        setTimeout(() => toast.className = '', 3000);
    }
};

window.App = App;

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
