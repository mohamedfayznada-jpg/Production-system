import { API } from './api.js';

const CONFIG = {
    // رابط جوجل سكريبت لرفع الصور
    GOOGLE_API_URL: "https://script.google.com/macros/s/AKfycbyVKapcO0hPx3j_d1HdHA6tOM8EX9etTzHmE9ZfvsldSI7lnFCMkuuSDdqH4mzr_HYecQ/exec",
    IMAGE_MAX_WIDTH: 800,
    IMAGE_MAX_HEIGHT: 800,
    IMAGE_QUALITY: 0.6
};

const App = {
    currentProdListener: null,
    currentDefectListener: null,
    currentSettingsListener: null,
    isOnline: true,
    saveTimers: {},
    charts: {},
    currentScreen: 'home',
    
    data: {
        settings: { 
            start: '07:30', 
            end: '16:00', 
            bStart: '12:30', 
            bEnd: '14:30', 
            lineName: 'التجميع النهائي', 
            defectTypes: ['خدش خفيف', 'خدش عميق', 'خبطة', 'تسييل لون', 'رايش'] 
        },
        generatedHours: [],
        scratches: []
    },

    async init() {
        setTimeout(() => { 
            const splash = document.getElementById('cinematic-splash'); 
            if(splash) { splash.style.opacity = '0'; setTimeout(() => splash.remove(), 800); }
        }, 1500);

        this.isOnline = await API.production.testConnection();
        this.updateConnectionStatus(this.isOnline);

        const today = new Date();
        const dateString = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        
        document.getElementById('global-date').value = dateString;
        document.getElementById('global-shift').value = "1";

        // الاستماع لإعدادات التطبيق من السحابة مباشرة لجميع الأجهزة
        this.currentSettingsListener = API.settings.listenToSettings((cloudSettings) => {
            if(cloudSettings) {
                this.data.settings = cloudSettings;
                this.applySettingsToFields();
                this.renderDefectTypesSettings();
                this.generateIntervals();
                
                // تحديث اسم الخط في الواجهة الرئيسية إن وجد
                const titleText = document.querySelector('.title-text');
                if(titleText) titleText.innerText = cloudSettings.lineName;
            } else {
                // إذا كانت قاعدة البيانات جديدة تماماً، قم بحفظ الإعدادات الافتراضية
                API.settings.saveSettings(this.data.settings);
            }
        });

        document.getElementById('global-date').addEventListener('change', () => this.loadDayData());
        document.getElementById('global-shift').addEventListener('change', () => this.loadDayData());

        if(this.isOnline) {
            this.loadDayData();
        } else {
            this.showToast("التطبيق يعمل بدون اتصال", true);
        }
    },

    updateConnectionStatus(isOnline) {
        const dot = document.getElementById('connection-status');
        if(isOnline) {
            dot.className = 'status-dot online'; dot.title = 'متصل بالسحابة';
        } else {
            dot.className = 'status-dot offline'; dot.title = 'يتم المزامنة بالخلفية';
        }
    },

    navigate(screenId) {
        if (screenId === 'settings') return; 
        this.currentScreen = screenId;
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const targetScreen = document.getElementById('screen-' + screenId);
        if(targetScreen) targetScreen.classList.add('active');
        
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const navBtn = document.querySelector(`.nav-item[data-target="${screenId}"]`);
        if(navBtn) navBtn.classList.add('active');
        
        if(screenId === 'analytics') this.renderAnalytics();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    openSettings() {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.settings-panel').forEach(p => p.style.display = 'none');
        document.getElementById('screen-settings').classList.add('active');
        let targetPanel = document.getElementById(`settings-panel-${this.currentScreen}`);
        if(!targetPanel) targetPanel = document.getElementById('settings-panel-home');
        targetPanel.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    closeSettings() { this.navigate(this.currentScreen); },

    // ---------------- Settings & Time Generators ----------------

    applySettingsToFields() {
        document.getElementById('set-shift-start').value = this.data.settings.start;
        document.getElementById('set-shift-end').value = this.data.settings.end;
        document.getElementById('set-break-start').value = this.data.settings.bStart;
        document.getElementById('set-break-end').value = this.data.settings.bEnd;
        document.getElementById('set-line-name').value = this.data.settings.lineName;
    },

    applySettings() {
        this.data.settings.start = document.getElementById('set-shift-start').value;
        this.data.settings.end = document.getElementById('set-shift-end').value;
        this.data.settings.bStart = document.getElementById('set-break-start').value;
        this.data.settings.bEnd = document.getElementById('set-break-end').value;
        this.data.settings.lineName = document.getElementById('set-line-name').value;
        
        // حفظ الإعدادات في السحابة بدلاً من المتصفح المحلي
        API.settings.saveSettings(this.data.settings);
        this.showToast("تم حفظ الإعدادات ومزامنتها لجميع الأجهزة ✅");
    },

    formatAMPM(timeStr) { 
        let [hours, minutes] = timeStr.split(':'); 
        hours = parseInt(hours); 
        let ampm = hours >= 12 ? 'م' : 'ص'; 
        hours = hours % 12; hours = hours ? hours : 12; 
        let hoursStr = hours < 10 ? '0' + hours : hours; 
        return `${hoursStr}:${minutes} ${ampm}`; 
    },
    
    addMinutes(timeStr, minsToAdd) { 
        let [h, m] = timeStr.split(':').map(Number); 
        let date = new Date(); date.setHours(h, m, 0); 
        date.setMinutes(date.getMinutes() + minsToAdd); 
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`; 
    },
    
    timeToMins(t) { 
        let [h, m] = t.split(':').map(Number); return h * 60 + m; 
    },

    generateIntervals() {
        const { start, end, bStart, bEnd } = this.data.settings;
        let current = start; let intervals = []; let endMins = this.timeToMins(end);
        if (endMins <= this.timeToMins(start)) endMins += 24 * 60;
        
        while (this.timeToMins(current) < endMins) {
            if (current === bStart) { 
                intervals.push({ isBreak: true, label: "فترة راحة" }); 
                current = bEnd; 
                continue; 
            }
            let nextHour = this.addMinutes(current, 60);
            if (this.timeToMins(nextHour) > this.timeToMins(bStart) && this.timeToMins(current) < this.timeToMins(bStart)) nextHour = bStart;
            if (this.timeToMins(nextHour) > endMins) nextHour = end;
            
            intervals.push({ isBreak: false, label: this.formatAMPM(current), rawTime: current });
            current = nextHour;
        }
        this.data.generatedHours = intervals;
        this.buildProductionUI();
    },

    renderDefectTypesSettings() {
        const container = document.getElementById('defect-types-list'); 
        const selectMenu = document.getElementById('scratch-type');
        if(!container || !selectMenu) return;
        container.innerHTML = ''; selectMenu.innerHTML = '';
        this.data.settings.defectTypes.forEach((type, index) => {
            container.innerHTML += `<div class="defect-badge-setting"><span>${type}</span><i class="fa-solid fa-xmark text-red" onclick="App.removeDefectType(${index})"></i></div>`;
            selectMenu.innerHTML += `<option value="${type}">${type}</option>`;
        });
    },

    addDefectType() {
        const input = document.getElementById('new-defect-type'); 
        const val = input.value.trim();
        if(val !== '' && !this.data.settings.defectTypes.includes(val)) {
            this.data.settings.defectTypes.push(val); 
            input.value = ''; 
            API.settings.saveSettings(this.data.settings);
            this.showToast("تم إضافة التصنيف ومزامنته للجميع");
        }
    },

    removeDefectType(index) {
        if(confirm("حذف هذا التصنيف من القائمة لجميع الأجهزة؟")) {
            this.data.settings.defectTypes.splice(index, 1); 
            API.settings.saveSettings(this.data.settings);
        }
    },

    // ---------------- Production Sync ----------------

    buildProductionUI() {
        const container = document.getElementById('production-list');
        container.innerHTML = '';

        this.data.generatedHours.forEach(timeSlot => {
            if (timeSlot.isBreak) {
                container.innerHTML += `<div class="hour-row break-row"><span>${timeSlot.label}</span></div>`;
            } else {
                container.innerHTML += `
                    <div class="hour-row" id="row-${timeSlot.rawTime.replace(':','-')}" data-hour="${timeSlot.rawTime}">
                        <div class="hour-header">
                            <span class="time-label">${timeSlot.label}</span>
                            <input type="number" class="actual-input" placeholder="0" 
                                oninput="App.handleProdInput('${timeSlot.rawTime}')">
                        </div>
                        <input type="text" class="reason-input" placeholder="سبب العجز (إن وجد)..." 
                            oninput="App.handleProdInput('${timeSlot.rawTime}')">
                    </div>
                `;
            }
        });
    },

    loadDayData() {
        if (!this.isOnline) return;
        const date = document.getElementById('global-date').value;
        const shift = document.getElementById('global-shift').value;

        if (this.currentProdListener) this.currentProdListener();
        if (this.currentDefectListener) this.currentDefectListener();

        this.clearInputs();

        // استماع للإنتاج
        this.currentProdListener = API.production.listenToShift(date, shift, (records) => {
            records.forEach(record => {
                const row = document.getElementById(`row-${record.hour.replace(':','-')}`);
                if (row) {
                    const actualInput = row.querySelector('.actual-input');
                    const reasonInput = row.querySelector('.reason-input');
                    if (document.activeElement !== actualInput) actualInput.value = record.actual || '';
                    if (document.activeElement !== reasonInput) reasonInput.value = record.shortfallReason || '';
                }
            });
            this.calculateLocalTotal();
        });

        // استماع للعيوب
        this.currentDefectListener = API.quality.listenToDefects(date, (records) => {
            this.data.scratches = records;
            this.renderScratchesList();
            if(this.currentScreen === 'analytics') this.renderAnalytics();
        });
    },

    clearInputs() {
        document.querySelectorAll('.actual-input').forEach(input => input.value = '');
        document.querySelectorAll('.reason-input').forEach(input => input.value = '');
        document.getElementById('live-total').innerText = '0';
        document.getElementById('home-total-prod').innerText = '0';
    },

    calculateLocalTotal() {
        let total = 0;
        document.querySelectorAll('.actual-input').forEach(input => { total += Number(input.value) || 0; });
        document.getElementById('live-total').innerText = total;
        document.getElementById('home-total-prod').innerText = total;
    },

    handleProdInput(hourStr) {
        this.calculateLocalTotal();
        const safeId = hourStr.replace(':','-');
        if (this.saveTimers[safeId]) clearTimeout(this.saveTimers[safeId]);

        this.saveTimers[safeId] = setTimeout(async () => {
            if (!this.isOnline) return;
            const date = document.getElementById('global-date').value;
            const shift = document.getElementById('global-shift').value;
            const row = document.getElementById(`row-${safeId}`);
            if(!row) return;

            const payload = {
                recordId: `${date}_${shift}_${safeId}`,
                date: date, shift: shift, hour: hourStr,
                actual: row.querySelector('.actual-input').value,
                shortfallReason: row.querySelector('.reason-input').value
            };

            try {
                row.classList.add('saving');
                await API.production.saveHour(payload);
                row.classList.remove('saving');
                this.updateConnectionStatus(true);
            } catch (e) { 
                row.classList.remove('saving'); 
                this.updateConnectionStatus(false);
            }
        }, 700);
    },

    // ---------------- Quality (Scratches) Sync ----------------

    addScratchDefect() {
        const type = document.getElementById('scratch-type').value;
        const notes = document.getElementById('scratch-notes').value;
        const fileInput = document.getElementById('scratch-image');
        const date = document.getElementById('global-date').value;
        
        const defectBase = {
            id: Date.now(), type: type, notes: notes, 
            status: 'pending', time: new Date().toLocaleTimeString('ar-EG', {hour: '2-digit', minute:'2-digit'}), 
            date: date
        };

        if(!fileInput.files || !fileInput.files[0]) { 
            defectBase.image = "";
            API.quality.saveDefect(defectBase);
            document.getElementById('scratch-notes').value = ''; 
            this.showToast("تم التسجيل والمزامنة بدون صورة ✅");
            return; 
        }

        if(CONFIG.GOOGLE_API_URL === '') { this.showToast("رابط الرفع غير موجود", true); return; }

        const loader = document.getElementById('upload-loader'); 
        loader.classList.add('show'); 
        
        const file = fileInput.files[0]; 
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const img = new Image();
            img.onload = async () => {
                const canvas = document.createElement('canvas'); 
                let width = img.width; let height = img.height;
                if (width > height) { if (width > CONFIG.IMAGE_MAX_WIDTH) { height *= CONFIG.IMAGE_MAX_WIDTH / width; width = CONFIG.IMAGE_MAX_WIDTH; } } 
                else { if (height > CONFIG.IMAGE_MAX_HEIGHT) { width *= CONFIG.IMAGE_MAX_HEIGHT / height; height = CONFIG.IMAGE_MAX_HEIGHT; } }
                canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);
                const compressedBase64 = canvas.toDataURL('image/webp', CONFIG.IMAGE_QUALITY);

                const uploadPayload = { type: "IMAGE_UPLOAD", payload: { filename: `Defect_${Date.now()}.webp`, mimeType: 'image/webp', base64: compressedBase64, date: date } };
                
                try {
                    let response = await fetch(CONFIG.GOOGLE_API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(uploadPayload) });
                    let result = JSON.parse(await response.text());
                    if (result.status === 'success') {
                        defectBase.image = result.url;
                        await API.quality.saveDefect(defectBase);
                        document.getElementById('scratch-notes').value = ''; fileInput.value = ''; 
                        App.showToast("تم الرفع والتسجيل بنجاح ✅");
                    } else { App.showToast("فشل الرفع السحابي للصورة ❌", true); }
                } catch (err) { App.showToast("خطأ شبكة أثناء الرفع ❌", true); } 
                finally { loader.classList.remove('show'); }
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    },

    renderScratchesList() {
        const container = document.getElementById('scratches-list'); container.innerHTML = '';
        let countToday = 0; let countFixed = 0; let countPending = 0;
        
        this.data.scratches.forEach(d => {
            countToday++;
            if (d.status === 'pending') countPending++;
            if (d.status === 'fixed') countFixed++; 
        });

        document.getElementById('qc-count-today').innerText = countToday;
        document.getElementById('qc-count-fixed').innerText = countFixed;
        document.getElementById('qc-count-pending').innerText = countPending;

        if(this.data.scratches.length === 0) { 
            container.innerHTML = `<div class="text-center text-muted mt-4">الخط خالي من العيوب 🚀</div>`; return; 
        }
        
        this.data.scratches.forEach(defect => {
            const isPending = defect.status === 'pending';
            const statusClass = isPending ? 'pending' : 'fixed';
            const statusText = isPending ? '⏳ قيد الإصلاح' : '✅ تم الإصلاح';
            const imgHtml = defect.image ? `<img src="${this.getImageUrl(defect.image)}" onclick="App.openImage('${this.getImageUrl(defect.image)}')" style="cursor: zoom-in;">` : '';

            container.innerHTML += `
                <div class="card defect-card" style="border-right-color: ${isPending ? 'var(--danger-color)' : 'var(--success-color)'};">
                    ${imgHtml}
                    <div style="flex: 1;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 5px;">
                            <h4 style="color:var(--text-main); font-size: 1rem; font-weight: 800;">${defect.type}</h4>
                            <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: bold;">${defect.time}</span>
                        </div>
                        <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 10px; font-weight: 600;">${defect.notes || 'لا توجد ملاحظات'}</p>
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span class="defect-badge ${statusClass}" onclick="App.toggleScratchStatus(${defect.id}, '${defect.status}')">${statusText}</span>
                            <i class="fa-solid fa-trash-can text-red" style="cursor:pointer; font-size: 1.2rem;" onclick="App.deleteScratch(${defect.id})"></i>
                        </div>
                    </div>
                </div>
            `;
        });
    },

    toggleScratchStatus(id, currentStatus) { 
        const newStatus = currentStatus === 'pending' ? 'fixed' : 'pending';
        API.quality.saveDefect({ id: id, status: newStatus });
    },
    
    deleteScratch(id) { 
        if(confirm("مسح السجل نهائياً؟")) API.quality.deleteDefect(id);
    },

    openImage(src) { document.getElementById('modal-image').src = src; document.getElementById('image-modal').classList.add('show'); },
    closeImageModal(e) { if(e.target.id === 'image-modal' || e.target.classList.contains('fa-xmark') || e.target.classList.contains('close-modal-btn')) document.getElementById('image-modal').classList.remove('show'); },

    getImageUrl(url) {
        if (!url) return "";
        if (url.includes("drive.google.com")) {
            const match = url.match(/id=([^&]+)/);
            if (match) return `https://lh3.googleusercontent.com/d/${match[1]}`;
        }
        return url;
    },

    // ---------------- Analytics & WhatsApp ----------------

    renderAnalytics() {
        let totalProd = Number(document.getElementById('live-total').innerText) || 0; 
        let activeHours = 0; let hourlyLabels = []; let hourlyData = [];
        
        document.querySelectorAll('.hour-row').forEach(row => {
            if(!row.classList.contains('break-row')) {
                const act = Number(row.querySelector('.actual-input').value) || 0;
                activeHours += (act > 0 ? 1 : 0);
                hourlyLabels.push(row.querySelector('.time-label').innerText.replace(' ص', '').replace(' م', ''));
                hourlyData.push(act);
            }
        });

        document.getElementById('analytics-avg-prod').innerText = activeHours > 0 ? (totalProd / activeHours).toFixed(1) : 0; 
        document.getElementById('analytics-total-defects').innerText = this.data.scratches.length;

        Chart.defaults.font.family = 'Cairo';
        Chart.defaults.color = '#94a3b8';

        if(this.charts.prod) this.charts.prod.destroy(); 
        this.charts.prod = new Chart(document.getElementById('prodChart').getContext('2d'), { 
            type: 'line', 
            data: { 
                labels: hourlyLabels, 
                datasets: [{ 
                    label: 'الإنتاج', 
                    data: hourlyData, 
                    backgroundColor: 'rgba(10, 179, 156, 0.2)', 
                    borderColor: '#0ab39c', 
                    borderWidth: 3, 
                    tension: 0.4,
                    fill: true
                }] 
            }, 
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } } } 
        });

        let defectCounts = {}; this.data.scratches.forEach(d => { defectCounts[d.type] = (defectCounts[d.type] || 0) + 1; });
        let defectLabels = Object.keys(defectCounts); let defectData = Object.values(defectCounts);
        
        if(this.charts.defects) this.charts.defects.destroy();
        this.charts.defects = new Chart(document.getElementById('defectsChart').getContext('2d'), { 
            type: 'doughnut', 
            data: { labels: defectLabels.length ? defectLabels : ['سجل نظيف'], datasets: [{ data: defectData.length ? defectData : [1], backgroundColor: defectData.length ? ['#f59e0b', '#0ab39c', '#8b5cf6', '#ef4444', '#3b82f6'] : ['#f1f5f9'], borderWidth: 0 }] }, 
            options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { position: 'right' } } } 
        });
    },

    sendWhatsAppReport() {
        let dParts = document.getElementById('global-date').value.split('-'); 
        let formattedDate = `${dParts[2]}-${dParts[1]}-${dParts[0]}`; 
        let total = 0; 
        let report = `*تقرير الإنتاج*\nالخط: ${this.data.settings.lineName}\nالتاريخ: ${formattedDate}\nالوردية: ${document.getElementById('global-shift').value}\n\n`; 
        
        document.querySelectorAll('.hour-row').forEach(row => {
            if(row.classList.contains('break-row')) {
                report += `\n*فترة راحة*\n\n`;
            } else {
                const label = row.querySelector('.time-label').innerText;
                const actual = row.querySelector('.actual-input').value || "0";
                const reason = row.querySelector('.reason-input').value;
                report += `${label} : ${actual}\n`;
                if(reason.trim() !== '') report += `- ${reason.trim()}\n`;
                total += Number(actual);
            }
        });

        report += `\n*إجمالي الإنتاج: ${total}*\n*إجمالي العيوب: ${this.data.scratches.length}*`;
        window.open(`https://wa.me/?text=${encodeURIComponent(report)}`, '_blank');
    },

    showToast(msg, isError = false) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.innerText = msg;
        toast.className = isError ? 'show error' : 'show';
        setTimeout(() => { toast.className = ''; }, 3000);
    },

    hardReset() {
        if(confirm("تحذير: سيتم مسح الإعدادات للبدء من جديد! هل أنت متأكد؟")) {
            // سنقوم بمسح المتصفح المحلي فقط ولا نمسح الداتا من السحابة لتبقى آمنة
            localStorage.removeItem(CONFIG.STORAGE_KEY);
            location.reload();
        }
    }
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
