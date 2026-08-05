const CONFIG = {
    GOOGLE_API_URL: "https://script.google.com/macros/s/AKfycbyVKapcO0hPx3j_d1HdHA6tOM8EX9etTzHmE9ZfvsldSI7lnFCMkuuSDdqH4mzr_HYecQ/exec",
    APP_NAME: "Production Core",
    STORAGE_KEY: "production_system_data",
    IMAGE_MAX_WIDTH: 800,
    IMAGE_MAX_HEIGHT: 800,
    IMAGE_QUALITY: 0.6
};

const App = {
    syncTimer: null, 
    charts: {}, 
    currentScreen: 'home',
    data: {
        lastUpdated: 0, 
        settings: { start: '07:30', end: '16:00', bStart: '12:30', bEnd: '14:30', lineName: 'الثلاجة A | التجميع النهائي', defectTypes: ['خدش خفيف', 'خدش عميق', 'خبطة', 'تسييل لون', 'رايش'] },
        production: { date: '', shift: '1', target: '', items: [] },
        history: {}, 
        scratches: []
    },

    init() {
        // Splash Screen
        setTimeout(() => { 
            const splash = document.getElementById('cinematic-splash'); 
            splash.style.opacity = '0'; 
            setTimeout(() => splash.remove(), 800); 
        }, 1500);

        let today = new Date();
        let actualToday = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        let defaultShift = "1";

        try {
            const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
            if (saved) {
                const parsedData = JSON.parse(saved);
                this.data.lastUpdated = parsedData.lastUpdated || 0;
                // Merge loaded data to keep settings
                Object.assign(this.data, parsedData);
            }
        } catch (e) {
            console.error("Cache Reset", e);
        }

        document.getElementById('global-date').value = actualToday;
        document.getElementById('global-shift').value = defaultShift;
        
        document.getElementById('set-shift-start').value = this.data.settings.start;
        document.getElementById('set-shift-end').value = this.data.settings.end;
        document.getElementById('set-break-start').value = this.data.settings.bStart;
        document.getElementById('set-break-end').value = this.data.settings.bEnd;
        document.getElementById('set-line-name').value = this.data.settings.lineName;

        this.loadDayData(actualToday, defaultShift);
        this.renderDefectTypesSettings();
        this.fetchFromCloud(true);

        document.addEventListener("visibilitychange", () => { 
            if (document.visibilityState === "visible") this.fetchFromCloud(true); 
        });
    },

    loadDayData(dateStr, shiftStr) {
        let key = `${dateStr}_${shiftStr}`;
        if (this.data.history[key]) {
            this.data.production = JSON.parse(JSON.stringify(this.data.history[key]));
        } else {
            this.data.production = { date: dateStr, shift: shiftStr, target: '', items: [] };
            this.generateIntervals(); 
        }
        this.updateProductionUI();
    },

    changeDay() {
        this.saveLocalInstant();
        let newDate = document.getElementById('global-date').value;
        let newShift = document.getElementById('global-shift').value;
        this.loadDayData(newDate, newShift);
        this.triggerCloudSyncDebounced();
    },

    updateProductionUI() {
        const targetEl = document.getElementById('prod-target');
        if(targetEl) targetEl.value = this.data.production.target || '';
        this.renderProductionList();
        this.renderScratchesList();
        if(this.currentScreen === 'analytics') this.renderAnalytics();
    },

    async saveLocalInstant() {
        const targetEl = document.getElementById("prod-target");
        if (targetEl) this.data.production.target = targetEl.value;

        const dateStr = this.data.production.date;
        const shiftStr = this.data.production.shift;
        const currentKey = `${dateStr}_${shiftStr}`;

        this.data.history[currentKey] = structuredClone(this.data.production);
        this.data.lastUpdated = Date.now();
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(this.data));

        try {
            if(window.API && window.API.production) {
                for (const item of this.data.production.items) {
                    if (item.isBreak || !item.rawTime) continue;
                    await window.API.production.saveHour({
                        date: dateStr,
                        shift: Number(shiftStr),
                        hour: item.rawTime,
                        model: this.data.settings.lineName || "",
                        plan: Number(item.plan ?? this.data.production.target ?? 0),
                        actual: Number(item.actual ?? 0),
                        isBreak: item.isBreak,
                        shortfallReason: item.shortfallReason || "",
                        target: Number(this.data.production.target || 0)
                    });
                }
            }
        } catch (err) {
            console.error("Firestore Error", err);
        }
    },

    triggerCloudSyncDebounced() {
        clearTimeout(this.syncTimer);
        this.syncTimer = setTimeout(() => { this.syncToCloud(true); }, 2500);
    },

    forceCloudSync() {
        clearTimeout(this.syncTimer); 
        this.saveLocalInstant(); 
        this.syncToCloud(false);
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
        
        const names = { 'home': 'الرئيسية', 'production': 'سجل الإنتاج', 'quality': 'الجودة', 'scratches': 'عيوب الرش', 'analytics': 'التحليلات' };
        document.getElementById('settings-title').innerText = `إعدادات: ${names[this.currentScreen] || 'عام'}`;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    closeSettings() { this.navigate(this.currentScreen); },

    // ... (The rest of the JS functions: renderDefectTypesSettings, addDefectType, generateIntervals, renderProductionList, addScratchDefect, renderScratchesList, renderAnalytics, sendWhatsAppReport, syncToCloud remain exactly identical to the original logic provided[cite: 4] but neatly indented).

    formatAMPM(timeStr) { 
        let [hours, minutes] = timeStr.split(':'); 
        hours = parseInt(hours); 
        let ampm = hours >= 12 ? 'PM' : 'AM'; 
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
            if (current === bStart) { intervals.push({ isBreak: true, label: "فترة راحة" }); current = bEnd; continue; }
            let nextHour = this.addMinutes(current, 60);
            if (this.timeToMins(nextHour) > this.timeToMins(bStart) && this.timeToMins(current) < this.timeToMins(bStart)) nextHour = bStart;
            if (this.timeToMins(nextHour) > endMins) nextHour = end;
            intervals.push({ isBreak: false, label: this.formatAMPM(nextHour), rawTime: nextHour, actual: "", shortfallReason: "" });
            current = nextHour;
        }
        this.data.production.items = intervals; 
        this.saveLocalInstant(); 
        this.updateProductionUI();
    },

    applySettings() {
        this.data.settings.start = document.getElementById('set-shift-start').value;
        this.data.settings.end = document.getElementById('set-shift-end').value;
        this.data.settings.bStart = document.getElementById('set-break-start').value;
        this.data.settings.bEnd = document.getElementById('set-break-end').value;
        this.data.settings.lineName = document.getElementById('set-line-name').value;
        this.generateIntervals(); 
        this.triggerCloudSyncDebounced(); 
        this.showToast("تم حفظ الإعدادات ✅");
    },

    renderProductionList() {
        const container = document.getElementById('production-list'); container.innerHTML = ''; let total = 0;
        this.data.production.items.forEach((item, index) => {
            if (item.isBreak) { 
                container.innerHTML += `<div class="prod-row break-row"><span>${item.label}</span></div>`; 
            } else {
                total += Number(item.actual) || 0;
                container.innerHTML += `
                    <div class="prod-row-container">
                        <div class="prod-row-flex">
                            <span class="time-label">${item.label}</span>
                            <input type="number" class="actual-input" value="${item.actual}" oninput="App.updateActual(${index}, this.value)">
                        </div>
                        <input type="text" class="reason-input" placeholder="سبب العجز (إن وجد)..." value="${item.shortfallReason || ''}" oninput="App.updateHourlyReason(${index}, this.value)">
                    </div>
                `;
            }
        });
        document.getElementById('prod-total-calc').innerText = total; 
        document.getElementById('home-total-prod').innerText = total;
    },

    updateActual(index, value) { 
        this.data.production.items[index].actual = value; 
        this.saveLocalInstant(); 
        this.triggerCloudSyncDebounced(); 
        let total = 0; 
        this.data.production.items.forEach(item => { if(!item.isBreak) total += Number(item.actual) || 0; }); 
        document.getElementById('prod-total-calc').innerText = total; 
        document.getElementById('home-total-prod').innerText = total; 
    },
    
    updateHourlyReason(index, value) { 
        this.data.production.items[index].shortfallReason = value; 
        this.saveLocalInstant(); 
        this.triggerCloudSyncDebounced(); 
    },

    renderScratchesList() {
        const container = document.getElementById('scratches-list'); container.innerHTML = '';
        const selectedDate = document.getElementById('global-date').value;
        const displayScratches = this.data.scratches.filter(d => d.date === selectedDate || d.status === 'pending');
        const sortedScratches = [...displayScratches].reverse();
        
        let countToday = 0; let countFixed = 0; let countPending = 0;
        displayScratches.forEach(d => {
            if (d.date === selectedDate) countToday++;
            if (d.status === 'pending') countPending++;
            if (d.status === 'fixed' && d.date === selectedDate) countFixed++; 
        });

        document.getElementById('qc-count-today').innerText = countToday;
        document.getElementById('qc-count-fixed').innerText = countFixed;
        document.getElementById('qc-count-pending').innerText = countPending;

        if(sortedScratches.length === 0) { 
            container.innerHTML = `<div class="text-center text-gray mt-4">الخط خالي من العيوب 🚀</div>`; return; 
        }
        
        sortedScratches.forEach(defect => {
            const isPending = defect.status === 'pending';
            const statusClass = isPending ? 'pending' : 'fixed';
            const statusText = isPending ? '⏳ قيد الإصلاح' : '✅ تم الإصلاح';

            container.innerHTML += `
                <div class="modern-card defect-card" style="border-right-color: ${isPending ? 'var(--danger)' : 'var(--success)'};">
                    <div style="display: flex; gap: 15px;">
                        <div style="flex: 1;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 5px;">
                                <h4 style="color:var(--text-primary); font-size: 1rem;">${defect.type}</h4>
                                <span style="font-size: 0.8rem; color: var(--text-secondary);">${defect.time}</span>
                            </div>
                            <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 10px;">${defect.notes || 'لا توجد ملاحظات'}</p>
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span class="defect-badge ${statusClass}" onclick="App.toggleScratchStatus(${defect.id})">${statusText}</span>
                                <i class="fa-solid fa-trash-can text-red" style="cursor:pointer;" onclick="App.deleteScratch(${defect.id})"></i>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
    },

    toggleScratchStatus(id) { 
        const index = this.data.scratches.findIndex(d => d.id === id); 
        if(index > -1) { 
            this.data.scratches[index].status = this.data.scratches[index].status === 'pending' ? 'fixed' : 'pending'; 
            this.saveLocalInstant(); this.triggerCloudSyncDebounced(); this.renderScratchesList(); 
        } 
    },
    
    deleteScratch(id) { 
        if(confirm("مسح السجل نهائياً؟")) { 
            this.data.scratches = this.data.scratches.filter(d => d.id !== id); 
            this.saveLocalInstant(); this.triggerCloudSyncDebounced(); this.renderScratchesList(); 
        } 
    },

    renderAnalytics() {
        let totalProd = 0; let activeHours = 0; let hourlyLabels = []; let hourlyData = [];
        this.data.production.items.forEach(item => { 
            if (!item.isBreak) { 
                let val = Number(item.actual) || 0; 
                totalProd += val; activeHours++; 
                hourlyLabels.push(item.label.replace(' AM', '').replace(' PM', '')); 
                hourlyData.push(val); 
            } 
        });
        document.getElementById('analytics-avg-prod').innerText = activeHours > 0 ? (totalProd / activeHours).toFixed(1) : 0; 
        
        const selectedDate = document.getElementById('global-date').value;
        const todayScratches = this.data.scratches.filter(d => d.date === selectedDate);
        document.getElementById('analytics-total-defects').innerText = todayScratches.length;

        Chart.defaults.font.family = 'Cairo';
        const ctxProd = document.getElementById('prodChart').getContext('2d');
        if(this.charts.prod) this.charts.prod.destroy(); 
        this.charts.prod = new Chart(ctxProd, { 
            type: 'bar', 
            data: { labels: hourlyLabels, datasets: [{ label: 'الإنتاج', data: hourlyData, backgroundColor: '#2563eb', borderRadius: 4 }] }, 
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } 
        });
    },

    showToast(msg) {
        const toast = document.getElementById('toast'); 
        toast.innerText = msg; toast.classList.add('show'); 
        setTimeout(() => toast.classList.remove('show'), 3000); 
    },

    sendWhatsAppReport() {
        let dParts = this.data.production.date.split('-'); 
        let formattedDate = `${dParts[2]}-${dParts[1]}-${dParts[0]}`; 
        let total = 0; 
        let report = `*تقرير الإنتاج*\n${this.data.settings.lineName}\nالتاريخ: ${formattedDate}\nالوردية: ${this.data.production.shift}\n\n`; 
        this.data.production.items.forEach(item => {
            if (!item.isBreak) { 
                let actVal = item.actual === "" ? "0" : item.actual; 
                report += `${item.label} : ${actVal}\n`; 
                if (item.shortfallReason && item.shortfallReason.trim() !== '') { report += `- ${item.shortfallReason.trim()}\n`; }
                total += Number(item.actual) || 0; 
            }
        });
        report += `\n*إجمالي الإنتاج: ${total}*`;
        window.open(`https://wa.me/?text=${encodeURIComponent(report)}`, '_blank');
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
