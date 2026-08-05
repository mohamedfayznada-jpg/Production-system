import { API } from './api.js';

const App = {
    currentListenerUnsubscribe: null,
    isOnline: false,
    
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
        // اختبار الاتصال بـ Firebase عند فتح التطبيق
        this.isOnline = await API.production.testConnection();
        this.updateConnectionStatus(this.isOnline);

        const today = new Date();
        const dateString = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        
        document.getElementById('global-date').value = dateString;
        document.getElementById('global-shift').value = "1";

        document.getElementById('global-date').addEventListener('change', () => this.loadCurrentShift());
        document.getElementById('global-shift').addEventListener('change', () => this.loadCurrentShift());

        this.buildProductionUI();
        
        // إذا كان متصلاً، ابدأ بجلب البيانات الحية
        if(this.isOnline) {
            this.loadCurrentShift();
        } else {
            this.showToast("خطأ: لا يوجد اتصال بالسيرفر أو الصلاحيات مرفوضة", true);
        }
    },

    updateConnectionStatus(isOnline) {
        const dot = document.getElementById('connection-status');
        if(isOnline) {
            dot.className = 'status-dot online';
            dot.title = 'متصل بالسحابة';
        } else {
            dot.className = 'status-dot offline';
            dot.title = 'غير متصل';
        }
    },

    buildProductionUI() {
        const container = document.getElementById('production-list');
        container.innerHTML = '';

        this.shiftHours.forEach(timeSlot => {
            const html = `
                <div class="hour-row" id="row-${timeSlot.hour}" data-hour="${timeSlot.hour}">
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

    loadCurrentShift() {
        if (!this.isOnline) return;

        const date = document.getElementById('global-date').value;
        const shift = document.getElementById('global-shift').value;

        if (this.currentListenerUnsubscribe) {
            this.currentListenerUnsubscribe();
        }

        this.clearInputs();

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
        let total = 0;

        records.forEach(record => {
            const row = document.getElementById(`row-${record.hour}`);
            if (row) {
                const actualInput = row.querySelector('.actual-input');
                const reasonInput = row.querySelector('.reason-input');
                
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

    async handleInputChange(hourStr) {
        if (!this.isOnline) {
            this.showToast("لا يمكن الحفظ، يرجى التحقق من الاتصال", true);
            return;
        }

        const date = document.getElementById('global-date').value;
        const shift = document.getElementById('global-shift').value;
        const row = document.getElementById(`row-${hourStr}`);
        
        const actualVal = row.querySelector('.actual-input').value;
        const reasonVal = row.querySelector('.reason-input').value;

        // تأثير بصري أثناء الحفظ
        row.classList.add('saving');

        const payload = {
            recordId: `${date}_${shift}_${hourStr}`,
            date: date,
            shift: shift,
            hour: hourStr,
            actual: actualVal,
            shortfallReason: reasonVal
        };

        try {
            await API.production.saveHour(payload);
            row.classList.remove('saving');
        } catch (error) {
            console.error(error);
            row.classList.remove('saving');
            this.showToast("فشل الحفظ في السيرفر", true);
            this.updateConnectionStatus(false);
            this.isOnline = false;
        }
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
