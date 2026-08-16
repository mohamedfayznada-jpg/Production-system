import { API } from './api.js';

const CONFIG = {
    GOOGLE_API_URL: "https://script.google.com/macros/s/AKfycbyVKapcO0hPx3j_d1HdHA6tOM8EX9etTzHmE9ZfvsldSI7lnFCMkuuSDdqH4mzr_HYecQ/exec",
    IMAGE_MAX_WIDTH: 800,
    IMAGE_MAX_HEIGHT: 800,
    IMAGE_QUALITY: 0.6
};

const App = {
    systemListenerUnsubscribe: null,
    currentSettingsListener: null,
    currentProdListener: null,
    currentDefectListener: null,
    masterProdListener: null,
    masterTargetListener: null,
    masterDefectListener: null,
    currentInventoryListener: null,
    fiveSLocationsListener: null,
    fiveSNotesListener: null,
    fiveSMonthlyListener: null,
    fiveSArchiveCheckKey: null,
    
    isOnline: true,
    saveTimers: {},
    charts: {},
    currentScreen: 'home',
    currentBalanceTab: 'cabinet', 
    analyticsMode: 'dept', 
    
    data: {
        departments: [],
        currentDepartment: '',
        settings: { start: '07:30', end: '16:00', bStart: '12:30', bEnd: '13:30', lineName: 'التجميع النهائي', defectTypes: ['خدش خفيف'] },
        generatedHours: [],
        scratches: [],
        inventory: { models: [], cabinet: {}, door: {} },
        master: { production: [], targets: [], scratches: [] },
        fiveS: { locations: [], notes: [], monthlySummaries: [] }
    },

    async init() {
        // تفعيل ملف الخدمة لتثبيت التطبيق
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW Error:', err));
        }

        // إظهار رسالة التثبيت عند جاهزية المتصفح
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            App.deferredPrompt = e;
            const installBanner = document.getElementById('install-banner');
            if (installBanner) installBanner.style.display = 'flex';
            if (manualBtn) manualBtn.style.display = 'block';
        });
        setTimeout(() => { 
            const splash = document.getElementById('cinematic-splash'); 
            if(splash) { splash.style.opacity = '0'; setTimeout(() => splash.remove(), 800); }
        }, 1500);
// --- الكود الجديد لطلب صلاحية الإشعارات ---
        if ('Notification' in window && Notification.permission !== 'granted') {
            Notification.requestPermission();
        }
        // متغير لحفظ آخر وقت، لكي لا يعطينا إشعارات للعيوب القديمة
        this.lastNotificationId = Date.now();
        // ------------------------------------------
        this.isOnline = await API.production.testConnection();
        this.updateConnectionStatus(this.isOnline);

        const today = new Date();
        const dateString = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        
        const globalDate = document.getElementById('global-date');
        const globalShift = document.getElementById('global-shift');
        
        if (globalDate) globalDate.value = dateString;
        if (globalShift) globalShift.value = "1";

        this.systemListenerUnsubscribe = API.system.listenToDepartments((depts) => {
            this.data.departments = depts;
            this.renderDepartmentSelector();
            this.renderSettingsDepartmentsList();
            this.render5SDepartmentOptions();
            this.render5SPlaceOptions();
            
            if(!this.data.currentDepartment && depts.length > 0) {
                this.data.currentDepartment = depts[0];
                const deptSelect = document.getElementById('global-department');
                if (deptSelect) deptSelect.value = this.data.currentDepartment;
                this.listenToCurrentDepartmentSettings();
            }
        });

        this.fiveSLocationsListener = API.fiveS.listenToLocations((locations) => {
            this.data.fiveS.locations = locations;
            this.render5SPlaceOptions();
            if (this.currentScreen === '5s') this.render5SNotes();
        });
        this.fiveSMonthlyListener = API.fiveS.listenToMonthlySummaries((summaries) => {
            this.data.fiveS.monthlySummaries = summaries;
            if (this.currentScreen === '5s') this.render5SArchive();
        });

        const fiveSDepartmentSelect = document.getElementById('5s-department');
        if (fiveSDepartmentSelect) fiveSDepartmentSelect.addEventListener('change', () => this.render5SPlaceOptions());

        const deptSelect = document.getElementById('global-department');
        if (deptSelect) {
            deptSelect.addEventListener('change', (e) => {
                this.data.currentDepartment = e.target.value;
                this.listenToCurrentDepartmentSettings(); 
            });
        }

        if (globalDate) globalDate.addEventListener('change', () => this.loadDayData());
        if (globalShift) globalShift.addEventListener('change', () => this.loadDayData());
    },

    showToast(msg, isError = false) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.innerText = msg;
        toast.className = isError ? 'show error' : 'show';
        setTimeout(() => { toast.className = ''; }, 3000);
    },

    // ---------------- الإدارة والأقسام ----------------
    renderDepartmentSelector() {
        const select = document.getElementById('global-department');
        if (!select) return;
        select.innerHTML = '';
        this.data.departments.forEach(dept => { select.innerHTML += `<option value="${dept}">${dept}</option>`; });
        if(this.data.currentDepartment) select.value = this.data.currentDepartment;
    },

    renderSettingsDepartmentsList() {
        const container = document.getElementById('departments-list');
        if (!container) return;
        container.innerHTML = '';
        this.data.departments.forEach((dept, index) => {
            const deleteBtn = this.data.departments.length > 1 ? `<i class="fa-solid fa-xmark text-red" onclick="App.removeDepartment(${index})"></i>` : '';
            container.innerHTML += `<div class="defect-badge-setting"><span>${dept}</span>${deleteBtn}</div>`;
        });
    },

    addDepartment() {
        const input = document.getElementById('new-department-name');
        if (!input) return;
        const val = input.value.trim();
        if(val !== '' && !this.data.departments.includes(val)) {
            this.data.departments.push(val);
            API.system.saveDepartments(this.data.departments);
            input.value = '';
            this.showToast("تم إضافة القسم الجديد");
        }
    },

    removeDepartment(index) {
        if(confirm("حذف هذا القسم سيمنع الوصول لبياناته السابقة. هل أنت متأكد؟")) {
            const removedDept = this.data.departments[index];
            this.data.departments.splice(index, 1);
            API.system.saveDepartments(this.data.departments);
            if(this.data.currentDepartment === removedDept) {
                this.data.currentDepartment = this.data.departments[0];
                const deptSelect = document.getElementById('global-department');
                if (deptSelect) deptSelect.value = this.data.currentDepartment;
                this.listenToCurrentDepartmentSettings();
            }
        }
    },

    listenToCurrentDepartmentSettings() {
        if(this.currentSettingsListener) this.currentSettingsListener();
        this.currentSettingsListener = API.settings.listenToSettings(this.data.currentDepartment, (cloudSettings) => {
            if(cloudSettings) {
                this.data.settings = cloudSettings;
            } else {
                this.data.settings = { start: '07:30', end: '16:00', bStart: '12:30', bEnd: '13:30', lineName: this.data.currentDepartment, defectTypes: ['خدش خفيف'] };
                API.settings.saveSettings(this.data.currentDepartment, this.data.settings);
            }
            this.applySettingsToFields();
            this.renderDefectTypesSettings();
            this.generateIntervals();
            this.loadDayData();
        });
    },

    updateConnectionStatus(isOnline) {
        const dot = document.getElementById('connection-status');
        if(!dot) return;
        if(isOnline) { dot.className = 'status-dot online'; dot.title = 'متصل بالسحابة'; } 
        else { dot.className = 'status-dot offline'; dot.title = 'غير متصل'; }
    },

    navigate(screenId) {
        if (screenId === 'settings') return; 
        this.currentScreen = screenId;
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const targetScreen = document.getElementById('screen-' + screenId);
        if(targetScreen) targetScreen.classList.add('active');
        
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const navBtn = document.querySelector(`.nav-item[data-target="${screenId === 'defects_log' || screenId === 'scratches' ? 'quality' : screenId}"]`);
        if(navBtn) navBtn.classList.add('active');
        
        if(screenId === 'analytics') this.renderAnalytics();
        if(screenId === '5s') this.render5SNotes();
        if(screenId === 'home') this.renderMasterDashboard();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    switchToDepartmentAndGo(deptName, screenId) {
        this.data.currentDepartment = deptName;
        const deptSelect = document.getElementById('global-department');
        if (deptSelect) deptSelect.value = deptName;
        this.listenToCurrentDepartmentSettings();
        this.navigate(screenId);
    },

    openSettings() {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.settings-panel').forEach(p => p.style.display = 'none');
        const settingsScreen = document.getElementById('screen-settings');
        if (settingsScreen) settingsScreen.classList.add('active');
        
        let targetPanel = document.getElementById(`settings-panel-${this.currentScreen}`);
        if(!targetPanel) targetPanel = document.getElementById('settings-panel-home');
        
        if(this.currentScreen === 'home' || this.currentScreen === 'quality' || this.currentScreen === 'analytics' || this.currentScreen === 'balances') {
            const deptsPanel = document.getElementById('settings-panel-departments');
            const homePanel = document.getElementById('settings-panel-home');
            if(deptsPanel) deptsPanel.style.display = 'block';
            if(homePanel) homePanel.style.display = 'block';
        } else {
            targetPanel.style.display = 'block';
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    closeSettings() { this.navigate(this.currentScreen); },

    // ---------------- إعدادات وتوليد الساعات ----------------
    applySettingsToFields() {
        const setStart = document.getElementById('set-shift-start');
        const setEnd = document.getElementById('set-shift-end');
        const setBStart = document.getElementById('set-break-start');
        const setBEnd = document.getElementById('set-break-end');
        const setLineName = document.getElementById('set-line-name');

        if(setStart) setStart.value = this.data.settings.start;
        if(setEnd) setEnd.value = this.data.settings.end;
        if(setBStart) setBStart.value = this.data.settings.bStart;
        if(setBEnd) setBEnd.value = this.data.settings.bEnd;
        if(setLineName) setLineName.value = this.data.settings.lineName;
    },

    applySettings() {
        this.data.settings.start = document.getElementById('set-shift-start').value;
        this.data.settings.end = document.getElementById('set-shift-end').value;
        this.data.settings.bStart = document.getElementById('set-break-start').value;
        this.data.settings.bEnd = document.getElementById('set-break-end').value;
        this.data.settings.lineName = document.getElementById('set-line-name').value;
        API.settings.saveSettings(this.data.currentDepartment, this.data.settings);
        this.showToast("تم حفظ الإعدادات للقسم الحالي ✅");
    },

    formatAMPM(timeStr) { 
        let [hours, minutes] = timeStr.split(':'); hours = parseInt(hours); 
        let ampm = hours >= 12 ? 'م' : 'ص'; hours = hours % 12; hours = hours ? hours : 12; 
        return `${hours < 10 ? '0'+hours : hours}:${minutes} ${ampm}`; 
    },
    
    addMinutes(timeStr, minsToAdd) { 
        let [h, m] = timeStr.split(':').map(Number); 
        let date = new Date(); date.setHours(h, m, 0); date.setMinutes(date.getMinutes() + minsToAdd); 
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`; 
    },
    
    timeToMins(t) { let [h, m] = t.split(':').map(Number); return h * 60 + m; },

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
            
            intervals.push({ isBreak: false, label: this.formatAMPM(nextHour), rawTime: nextHour });
            current = nextHour;
        }
        this.data.generatedHours = intervals;
        this.buildProductionUI();
    },

    buildProductionUI() {
        const container = document.getElementById('production-list');
        if (!container) return;
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
        if (!this.isOnline || !this.data.currentDepartment) return;
        const date = document.getElementById('global-date').value;
        const shift = document.getElementById('global-shift').value;
        this.run5SClientArchiveIfNeeded();

        if (this.currentProdListener) this.currentProdListener();
        if (this.currentDefectListener) this.currentDefectListener();
        if (this.masterProdListener) this.masterProdListener();
        if (this.masterTargetListener) this.masterTargetListener();
        if (this.masterDefectListener) this.masterDefectListener();
        if (this.currentInventoryListener) this.currentInventoryListener();
        if (this.fiveSNotesListener) this.fiveSNotesListener();

        this.clearInputs();

        API.production.listenToTarget(this.data.currentDepartment, date, shift, (targetVal) => {
            const tInput = document.getElementById('prod-target');
            if(tInput && document.activeElement !== tInput) tInput.value = targetVal || '';
        });

        this.currentProdListener = API.production.listenToShift(this.data.currentDepartment, date, shift, (records) => {
            records.forEach(record => {
                const row = document.getElementById(`row-${record.hour.replace(':','-')}`);
                if (row) {
                    const actualInput = row.querySelector('.actual-input');
                    const reasonInput = row.querySelector('.reason-input');
                    if (actualInput && document.activeElement !== actualInput) actualInput.value = record.actual || '';
                    if (reasonInput && document.activeElement !== reasonInput) reasonInput.value = record.shortfallReason || '';
                }
            });
            this.calculateLocalTotal();
        });

        this.currentDefectListener = API.quality.listenToDefects(this.data.currentDepartment, date, (records) => {
            this.data.scratches = records;
            this.renderScratchesList();
            if(this.currentScreen === 'analytics') this.renderAnalytics();
        });

        this.masterProdListener = API.master.listenToAllProduction(date, shift, (records) => {
            this.data.master.production = records;
            if(this.currentScreen === 'home' || this.currentScreen === 'analytics') {
                this.renderMasterDashboard();
                if(this.currentScreen === 'analytics') this.renderAnalytics();
            }
        });
        this.masterTargetListener = API.master.listenToAllTargets(date, shift, (records) => {
            this.data.master.targets = records;
            if(this.currentScreen === 'home' || this.currentScreen === 'analytics') {
                this.renderMasterDashboard();
                if(this.currentScreen === 'analytics') this.renderAnalytics();
            }
        });
      this.masterDefectListener = API.master.listenToAllScratches(date, (records) => {
            this.data.master.scratches = records;
            if(this.currentScreen === 'home' || this.currentScreen === 'analytics') {
                this.renderMasterDashboard();
                if(this.currentScreen === 'analytics') this.renderAnalytics();
            }

            // --- الكود الجديد لاكتشاف العيوب الجديدة وإطلاق الإشعار ---
            let maxId = App.lastNotificationId;
            records.forEach(r => {
                // إذا كان العيب أحدث من آخر عيب تم رؤيته، وحالته "قيد الإصلاح"
                if (r.id > App.lastNotificationId && r.status === 'pending') {
                    App.showSystemNotification(
                        `🚨 عيب جديد في: ${r.department}`, 
                        `الموديل: ${r.notes}\nالعيب: ${r.type}`
                    );
                    if(r.id > maxId) maxId = r.id; // تحديث العداد
                }
            });
            App.lastNotificationId = maxId;
            // ----------------------------------------------------
        });

        this.currentInventoryListener = API.balances.listenToInventory((invData) => {
            this.data.inventory = invData;
            this.renderInventory();
            this.populateDefectModelsList(); // تحديث قائمة الموديلات في شاشة الجودة
        });

        this.fiveSNotesListener = API.fiveS.listenToNotes(date, (records) => {
            this.data.fiveS.notes = records;
            if (this.currentScreen === '5s') this.render5SNotes();
        });
    },

    async run5SClientArchiveIfNeeded() {
        const today = new Date();
        const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        if (this.fiveSArchiveCheckKey === currentMonthKey) return;
        this.fiveSArchiveCheckKey = currentMonthKey;
        try {
            const result = await API.fiveS.archivePreviousMonths(currentMonthKey);
            if (result.archivedNotes > 0) {
                this.showToast(`تمت أرشفة ${result.archivedNotes} ملاحظة قديمة مجاناً ✅`);
            }
        } catch (error) {
            console.warn('5S client archive skipped:', error);
            this.fiveSArchiveCheckKey = null;
        }
    },

    clearInputs() {
        document.querySelectorAll('.actual-input').forEach(input => input.value = '');
        document.querySelectorAll('.reason-input').forEach(input => input.value = '');
        const liveTotal = document.getElementById('live-total');
        if (liveTotal) liveTotal.innerText = '0';
    },

    calculateLocalTotal() {
        let total = 0;
        document.querySelectorAll('.actual-input').forEach(input => { total += Number(input.value) || 0; });
        const liveTotal = document.getElementById('live-total');
        if(liveTotal) liveTotal.innerText = total;
    },

    saveTarget() {
        if (!this.isOnline) return;
        const date = document.getElementById('global-date').value;
        const shift = document.getElementById('global-shift').value;
        const targetVal = document.getElementById('prod-target').value;
        
        if(this.saveTimers['target']) clearTimeout(this.saveTimers['target']);
        this.saveTimers['target'] = setTimeout(() => {
            API.production.saveTarget(this.data.currentDepartment, date, shift, targetVal);
        }, 1000);
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
                recordId: `${this.data.currentDepartment}_${date}_${shift}_${safeId}`,
                date: date, shift: shift, hour: hourStr,
                actual: Number(row.querySelector('.actual-input').value) || 0,
                shortfallReason: row.querySelector('.reason-input').value
            };

            try {
                row.classList.add('saving');
                await API.production.saveHour(this.data.currentDepartment, payload);
                row.classList.remove('saving');
                this.updateConnectionStatus(true);
            } catch (e) { 
                row.classList.remove('saving'); 
                this.updateConnectionStatus(false);
            }
        }, 700);
    },

    // ---------------- Master Dashboard ----------------
    renderMasterDashboard() {
        let factoryTotalActual = 0;
        let factoryTotalTarget = 0;
        let deptProd = {};
        let deptScratches = {};

        this.data.departments.forEach(d => { 
            deptProd[d] = {}; 
            deptScratches[d] = 0; 
        });

        if(this.data.master.production) {
            this.data.master.production.forEach(r => {
                if(r.department && this.data.departments.includes(r.department)) {
                    if(r.recordId && r.recordId.startsWith(r.department)) {
                        const val = Number(r.actual) || 0;
                        const hourPrefix = r.hour.split(':')[0]; 
                        if (deptProd[r.department][hourPrefix] === undefined) {
                            deptProd[r.department][hourPrefix] = val;
                        } else {
                            deptProd[r.department][hourPrefix] = Math.max(deptProd[r.department][hourPrefix], val);
                        }
                    }
                }
            });
        }

        let validTargets = {};
        if(this.data.master.targets) {
            this.data.master.targets.forEach(r => {
                if(r.department && this.data.departments.includes(r.department)) {
                    validTargets[r.department] = Number(r.target) || 0;
                }
            });
        }
        
        factoryTotalTarget = validTargets['التجميع النهائي'] || 0;

        if(this.data.master.scratches) {
            this.data.master.scratches.forEach(r => {
                if(r.department && deptScratches[r.department] !== undefined) {
                    deptScratches[r.department] += 1;
                }
            });
        }

        let finalDeptProdTotals = {};
        this.data.departments.forEach(d => {
            const sum = Object.values(deptProd[d]).reduce((acc, val) => acc + val, 0);
            finalDeptProdTotals[d] = sum;
            if (d === 'التجميع النهائي') {
                factoryTotalActual += sum; 
            }
        });

        const masterTotalProdEl = document.getElementById('master-total-prod');
        if (masterTotalProdEl) masterTotalProdEl.innerText = factoryTotalActual;

        const masterTotalTargetEl = document.getElementById('master-total-target');
        if (masterTotalTargetEl) masterTotalTargetEl.innerText = factoryTotalTarget;

        const cardsContainer = document.getElementById('master-departments-cards');
        if(cardsContainer) {
            cardsContainer.innerHTML = '';
            this.data.departments.forEach(dept => {
                const prod = finalDeptProdTotals[dept];
                const target = validTargets[dept] || 0;
                const pct = target > 0 ? Math.round((prod / target) * 100) : 0;
                let colorClass = pct >= 90 ? 'text-green' : (pct >= 70 ? 'text-orange' : 'text-red');
                if (target === 0) colorClass = 'text-main';

                cardsContainer.innerHTML += `
                    <div class="card mb-0" style="padding: 15px; border-right: 4px solid var(--primary-color); cursor:pointer;" onclick="App.switchToDepartmentAndGo('${dept}', 'analytics')">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div>
                                <h4 style="font-size:1.1rem; color:var(--text-main); margin-bottom:5px;">${dept}</h4>
                                <span style="font-size:0.85rem; color:var(--text-muted);">الهدف: ${target}</span>
                            </div>
                            <div style="text-align:left;">
                                <div style="font-size:1.6rem; font-weight:800; color:var(--primary-color); line-height:1;">${prod}</div>
                                <span class="${colorClass}" style="font-size:0.8rem; font-weight:bold;">${pct}%</span>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        Chart.defaults.font.family = 'Cairo';
        Chart.defaults.color = '#94a3b8';

        const depts = this.data.departments;
        const prodData = depts.map(d => finalDeptProdTotals[d]);
        const scratchData = depts.map(d => deptScratches[d]);

        const prodChartCanvas = document.getElementById('masterProdChart');
        if (prodChartCanvas) {
            if(this.charts.masterProd) this.charts.masterProd.destroy(); 
            this.charts.masterProd = new Chart(prodChartCanvas.getContext('2d'), { 
                type: 'bar', 
                data: { labels: depts, datasets: [{ label: 'الإنتاج', data: prodData, backgroundColor: '#0ab39c', borderRadius: 4 }] }, 
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, onClick: (e, elements) => { if(elements.length > 0) this.switchToDepartmentAndGo(depts[elements[0].index], 'analytics'); } } 
            });
        }

        const defectsChartCanvas = document.getElementById('masterDefectsChart');
        if (defectsChartCanvas) {
            if(this.charts.masterDefects) this.charts.masterDefects.destroy(); 
            this.charts.masterDefects = new Chart(defectsChartCanvas.getContext('2d'), { 
                type: 'bar', 
                data: { labels: depts, datasets: [{ label: 'عيوب الرش', data: scratchData, backgroundColor: '#f59e0b', borderRadius: 4 }] }, 
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, onClick: (e, elements) => { if(elements.length > 0) this.switchToDepartmentAndGo(depts[elements[0].index], 'scratches'); } } 
            });
        }
    },

    // ---------------- الأرصدة والمخزون ----------------
    switchBalanceTab(tabId) {
        this.currentBalanceTab = tabId;
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.querySelector(`.tab-btn[onclick="App.switchBalanceTab('${tabId}')"]`);
        if(activeBtn) activeBtn.classList.add('active');
        
        const addCard = document.getElementById('add-model-card');
        if(addCard) addCard.style.display = tabId === 'final' ? 'none' : 'block';
        
        this.renderInventory();
    },

    addInventoryModel() {
        const nameInput = document.getElementById('inv-model-name');
        const colorInput = document.getElementById('inv-model-color');
        const is3DoorInput = document.getElementById('inv-is-3door');
        
        const name = nameInput.value.trim();
        const color = colorInput.value.trim();
        const is3Door = is3DoorInput.checked;

        if(name === '') { this.showToast('أدخل اسم الموديل', true); return; }

        const newId = Date.now().toString();
        this.data.inventory.models = this.data.inventory.models || [];
        this.data.inventory.cabinet = this.data.inventory.cabinet || {};
        this.data.inventory.door = this.data.inventory.door || {};

        this.data.inventory.models.push({ id: newId, name: name, color: color, is3Door: is3Door });
        this.data.inventory.cabinet[newId] = { boq: '', out: '' };
        this.data.inventory.door[newId] = { r: '', f: '', v: '' };

        API.balances.saveInventory(this.data.inventory);
        
        nameInput.value = ''; colorInput.value = ''; is3DoorInput.checked = false;
        this.showToast('تمت الإضافة للمخزون ✅');
    },

    deleteInventoryModel(modelId) {
        if(!confirm('هل أنت متأكد من حذف هذا الموديل بأرصدته؟')) return;
        
        this.data.inventory.models = this.data.inventory.models.filter(m => m.id !== modelId);
        delete this.data.inventory.cabinet[modelId];
        delete this.data.inventory.door[modelId];
        
        API.balances.saveInventory(this.data.inventory);
        this.showToast('تم حذف الموديل');
    },

    handleInventoryInput(modelId, part, field) {
        const inputEl = document.getElementById(`inv_${part}_${modelId}_${field}`);
        if(!inputEl) return;
        
        const val = inputEl.value;
        this.data.inventory[part][modelId][field] = val;

        const timerId = `inv_${modelId}_${part}_${field}`;
        if(this.saveTimers[timerId]) clearTimeout(this.saveTimers[timerId]);
        this.saveTimers[timerId] = setTimeout(() => {
            API.balances.saveInventory(this.data.inventory);
        }, 1000);
    },

    renderInventory() {
        const container = document.getElementById('inventory-list');
        if(!container) return;
        container.innerHTML = '';

        const models = this.data.inventory.models || [];
        if(models.length === 0) {
            container.innerHTML = `<div class="text-center text-muted" style="padding: 30px;">لا توجد موديلات في المخزون. أضف موديل للبدء.</div>`;
            return;
        }

        models.forEach(model => {
            let contentHtml = '';
            let badgeHtml = model.is3Door ? `<span class="inv-badge">3 باب</span>` : `<span class="inv-badge" style="background:#e0f2fe; color:var(--primary-color);">2 باب</span>`;
            
            if (this.currentBalanceTab === 'cabinet') {
                const cabData = this.data.inventory.cabinet[model.id] || { boq:'', out:'' };
                contentHtml = `
                    <div class="inv-inputs-grid">
                        <div class="inv-input-group">
                            <label>رصيد المقايسة</label>
                            <input type="number" id="inv_cabinet_${model.id}_boq" class="inv-input" placeholder="0" value="${cabData.boq}" oninput="App.handleInventoryInput('${model.id}', 'cabinet', 'boq')">
                        </div>
                        <div class="inv-input-group">
                            <label>خارج المقايسة</label>
                            <input type="number" id="inv_cabinet_${model.id}_out" class="inv-input" placeholder="0" value="${cabData.out}" oninput="App.handleInventoryInput('${model.id}', 'cabinet', 'out')">
                        </div>
                    </div>
                `;
            } 
            else if (this.currentBalanceTab === 'door') {
                const doorData = this.data.inventory.door[model.id] || { r:'', f:'', v:'' };
                const gridCols = model.is3Door ? '1fr 1fr 1fr' : '1fr 1fr';
                const vInput = model.is3Door ? `
                    <div class="inv-input-group">
                        <label>باب V</label>
                        <input type="number" id="inv_door_${model.id}_v" class="inv-input" placeholder="0" value="${doorData.v}" oninput="App.handleInventoryInput('${model.id}', 'door', 'v')">
                    </div>` : '';

                contentHtml = `
                    <div class="inv-inputs-grid" style="grid-template-columns: ${gridCols};">
                        <div class="inv-input-group">
                            <label>باب R</label>
                            <input type="number" id="inv_door_${model.id}_r" class="inv-input" placeholder="0" value="${doorData.r}" oninput="App.handleInventoryInput('${model.id}', 'door', 'r')">
                        </div>
                        <div class="inv-input-group">
                            <label>باب F</label>
                            <input type="number" id="inv_door_${model.id}_f" class="inv-input" placeholder="0" value="${doorData.f}" oninput="App.handleInventoryInput('${model.id}', 'door', 'f')">
                        </div>
                        ${vInput}
                    </div>
                `;
            }
            else if (this.currentBalanceTab === 'final') {
                const cabData = this.data.inventory.cabinet[model.id] || {boq:0, out:0};
                const doorData = this.data.inventory.door[model.id] || {r:0, f:0, v:0};
                
                const cabTotal = (Number(cabData.boq) || 0) + (Number(cabData.out) || 0);
                const r = Number(doorData.r) || 0;
                const f = Number(doorData.f) || 0;
                const v = Number(doorData.v) || 0;

                let availableSets = 0;
                if(model.is3Door) { availableSets = Math.min(cabTotal, r, f, v); } 
                else { availableSets = Math.min(cabTotal, r, f); }

                const vBox = model.is3Door ? `<div class="inv-stat-box"><span class="inv-stat-lbl">باب V</span><span class="inv-stat-val">${v}</span></div>` : '';
                
                contentHtml = `
                    <div class="inv-final-grid" style="${model.is3Door ? 'grid-template-columns: repeat(4, 1fr);' : 'grid-template-columns: repeat(3, 1fr);'}">
                        <div class="inv-stat-box"><span class="inv-stat-lbl">كابينة</span><span class="inv-stat-val text-primary">${cabTotal}</span></div>
                        <div class="inv-stat-box"><span class="inv-stat-lbl">باب R</span><span class="inv-stat-val">${r}</span></div>
                        <div class="inv-stat-box"><span class="inv-stat-lbl">باب F</span><span class="inv-stat-val">${f}</span></div>
                        ${vBox}
                    </div>
                    <div class="inv-result">
                        <span>متاح للتجميع النهائي:</span>
                        <span class="set-qty">${availableSets}</span>
                    </div>
                `;
            }

            container.innerHTML += `
                <div class="card inv-card mb-4" style="margin-bottom: 15px;">
                    <div class="inv-header">
                        <div class="inv-title">${model.name} <span style="color:var(--text-muted); font-size:0.9rem;">${model.color ? ' - '+model.color : ''}</span></div>
                        <div>
                            ${badgeHtml}
                            <i class="fa-solid fa-trash-can text-red ml-2" style="cursor:pointer; margin-right:10px;" onclick="App.deleteInventoryModel('${model.id}')"></i>
                        </div>
                    </div>
                    ${contentHtml}
                </div>
            `;
        });
    },

    // ---------------- قراءة الباركود (مبدئياً) ----------------
    scanBarcode() {
        const scanInput = document.getElementById('inv-barcode-scan');
        if(!scanInput || scanInput.value.trim() === '') {
            this.showToast('يرجى توصيل الماسح الضوئي وتمرير الباركود هنا', true);
            return;
        }
        // سيتم برمجة خوارزمية شيت الإكسيل لاحقاً هنا
        this.showToast(`تم قراءة الباركود: ${scanInput.value}. (في انتظار ربط الإكسيل)`);
        scanInput.value = '';
    },

    // ---------------- الجودة ----------------
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
    
    // ربط قائمة الموديلات للعيوب (جديد)
    populateDefectModelsList() {
        const selectMenu = document.getElementById('scratch-model');
        if(!selectMenu) return;
        
        // الاحتفاظ بالخيار الأول (المطالبة بالاختيار)
        selectMenu.innerHTML = '<option value="">-- اختر الموديل المعيب --</option>';
        selectMenu.innerHTML += '<option value="غير محدد / عام">غير محدد / عام</option>';
        
        const models = this.data.inventory.models || [];
        models.forEach(model => {
            const displayName = `${model.name} ${model.color ? '('+model.color+')' : ''}`;
            selectMenu.innerHTML += `<option value="${displayName}">${displayName}</option>`;
        });
    },

    addDefectType() {
        const input = document.getElementById('new-defect-type'); 
        if(!input) return;
        const val = input.value.trim();
        if(val !== '' && !this.data.settings.defectTypes.includes(val)) {
            this.data.settings.defectTypes.push(val); 
            input.value = ''; 
            API.settings.saveSettings(this.data.currentDepartment, this.data.settings);
            this.showToast("تم إضافة التصنيف");
        }
    },
    removeDefectType(index) {
        if(confirm("حذف هذا التصنيف من القسم الحالي؟")) {
            this.data.settings.defectTypes.splice(index, 1); 
            API.settings.saveSettings(this.data.currentDepartment, this.data.settings);
        }
    },

    addScratchDefect() {
        const modelEl = document.getElementById('scratch-model');
        const typeEl = document.getElementById('scratch-type');
        const notesEl = document.getElementById('scratch-notes');
        const fileInput = document.getElementById('scratch-image');
        const dateEl = document.getElementById('global-date');
        
        if (!typeEl || !dateEl) return;

        const date = dateEl.value;
        const modelName = modelEl && modelEl.value !== '' ? `[${modelEl.value}] ` : '';
        const finalNotes = modelName + (notesEl ? notesEl.value : '');

        const defectBase = { id: Date.now(), type: typeEl.value, notes: finalNotes, status: 'pending', time: new Date().toLocaleTimeString('ar-EG', {hour: '2-digit', minute:'2-digit'}), date: date };

        if(!fileInput || !fileInput.files || !fileInput.files[0]) { 
            defectBase.image = ""; API.quality.saveDefect(this.data.currentDepartment, defectBase);
            if(notesEl) notesEl.value = ''; this.showToast("تم التسجيل بدون صورة ✅"); return; 
        }

        if(CONFIG.GOOGLE_API_URL === '') { this.showToast("رابط الرفع غير موجود", true); return; }

        const loader = document.getElementById('upload-loader'); if(loader) loader.classList.add('show'); 
        const file = fileInput.files[0]; const reader = new FileReader();
        
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
                        defectBase.image = result.url; await API.quality.saveDefect(this.data.currentDepartment, defectBase);
                        if(notesEl) notesEl.value = ''; if(fileInput) fileInput.value = ''; App.showToast("تم الرفع والتسجيل بنجاح ✅");
                    } else { App.showToast("فشل الرفع للصورة ❌", true); }
                } catch (err) { App.showToast("خطأ شبكة أثناء الرفع ❌", true); } 
                finally { if(loader) loader.classList.remove('show'); }
            }; img.src = e.target.result;
        }; reader.readAsDataURL(file);
    },

    renderScratchesList() {
        const container = document.getElementById('scratches-list'); 
        if(!container) return; container.innerHTML = '';
        
        let countToday = 0; let countFixed = 0; let countPending = 0;
        const globalDate = document.getElementById('global-date').value;
        
        this.data.scratches.forEach(d => { 
            if (d.date === globalDate) countToday++; 
            if (d.status === 'pending') countPending++; 
            if (d.status === 'fixed' && d.date === globalDate) countFixed++; 
        });

        const qcToday = document.getElementById('qc-count-today'); 
        const qcFixed = document.getElementById('qc-count-fixed'); 
        const qcPending = document.getElementById('qc-count-pending');
        if(qcToday) qcToday.innerText = countToday; 
        if(qcFixed) qcFixed.innerText = countFixed; 
        if(qcPending) qcPending.innerText = countPending;

        if(this.data.scratches.length === 0) { container.innerHTML = `<div class="text-center text-muted mt-4">الخط خالي من العيوب 🚀</div>`; return; }
        
        this.data.scratches.forEach(defect => {
            const isPending = defect.status === 'pending';
            const statusClass = isPending ? 'pending' : 'fixed';
            const statusText = isPending ? '⏳ قيد الإصلاح' : '✅ تم الإصلاح';
            const dateText = defect.date === globalDate ? defect.time : `<span class="text-red">${defect.date}</span>`;
            const imgHtml = defect.image ? `<img src="${this.getImageUrl(defect.image)}" onclick="App.openImage('${this.getImageUrl(defect.image)}')" style="cursor: zoom-in;">` : '';

            container.innerHTML += `
                <div class="card defect-card" style="border-right-color: ${isPending ? 'var(--danger-color)' : 'var(--success-color)'};">
                    ${imgHtml}
                    <div style="flex: 1;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 5px;">
                            <h4 style="color:var(--text-main); font-size: 1rem; font-weight: 800;">${defect.type}</h4>
                            <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: bold;">${dateText}</span>
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

    toggleScratchStatus(id, currentStatus) { const newStatus = currentStatus === 'pending' ? 'fixed' : 'pending'; API.quality.saveDefect(this.data.currentDepartment, { id: id, status: newStatus }); },
    deleteScratch(id) { if(confirm("مسح السجل نهائياً؟")) API.quality.deleteDefect(id); },
    openImage(src) { const modalImg = document.getElementById('modal-image'); const modal = document.getElementById('image-modal'); if(modalImg && modal) { modalImg.src = src; modal.classList.add('show'); } },
    closeImageModal(e) { const modal = document.getElementById('image-modal'); if(modal && (e.target.id === 'image-modal' || e.target.classList.contains('fa-xmark') || e.target.classList.contains('close-modal-btn'))) { modal.classList.remove('show'); } },
    getImageUrl(url) {
        const value = String(url || '').trim();
        if (!value || !/^https?:\/\//i.test(value)) return '';
        if (!/drive\.google\.com|googleusercontent\.com|drive\.usercontent\.google\.com/i.test(value)) return value;
        const patterns = [
            /[?&]id=([^&]+)/i,
            /\/file\/d\/([^/?#]+)/i,
            /\/d\/([^/?#]+)/i
        ];
        for (const pattern of patterns) {
            const match = value.match(pattern);
            if (match && match[1]) return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(match[1])}`;
        }
        return value;
    },

    // ---------------- التقارير والتحليلات الشاملة (مع باريتو) ----------------
    switchAnalyticsMode(mode) {
        this.analyticsMode = mode;
        const btnDept = document.getElementById('btn-analytics-dept');
        const btnFactory = document.getElementById('btn-analytics-factory');
        if(btnDept) btnDept.classList.toggle('active', mode === 'dept');
        if(btnFactory) btnFactory.classList.toggle('active', mode === 'factory');
        
        const viewDept = document.getElementById('analytics-dept-view');
        const viewFactory = document.getElementById('analytics-factory-view');
        if(viewDept) viewDept.style.display = mode === 'dept' ? 'block' : 'none';
        if(viewFactory) viewFactory.style.display = mode === 'factory' ? 'block' : 'none';
        
        this.renderAnalytics();
    },

    renderAnalytics() {
        Chart.defaults.font.family = 'Cairo'; 
        Chart.defaults.color = '#94a3b8';

        if(this.analyticsMode === 'dept') {
            // تحليلات القسم الحالي
            const liveTotalEl = document.getElementById('live-total');
            let totalProd = Number(liveTotalEl ? liveTotalEl.innerText : 0) || 0; 
            let activeHours = 0; let hourlyLabels = []; let hourlyData = [];
            
            document.querySelectorAll('.hour-row').forEach(row => {
                if(!row.classList.contains('break-row')) {
                    const actualInput = row.querySelector('.actual-input');
                    const timeLabel = row.querySelector('.time-label');
                    if (actualInput && timeLabel) {
                        const act = Number(actualInput.value) || 0;
                        activeHours += (act > 0 ? 1 : 0);
                        hourlyLabels.push(timeLabel.innerText.replace(' ص', '').replace(' م', ''));
                        hourlyData.push(act);
                    }
                }
            });

            const avgProdEl = document.getElementById('analytics-avg-prod');
            if(avgProdEl) avgProdEl.innerText = activeHours > 0 ? (totalProd / activeHours).toFixed(1) : 0; 
            
            const totalDefectsEl = document.getElementById('analytics-total-defects');
            const todayScratches = this.data.scratches.filter(d => d.date === document.getElementById('global-date').value);
            if(totalDefectsEl) totalDefectsEl.innerText = todayScratches.length;

            const prodChartCanvas = document.getElementById('prodChart');
            if (prodChartCanvas) {
                if(this.charts.prod) this.charts.prod.destroy(); 
                this.charts.prod = new Chart(prodChartCanvas.getContext('2d'), { type: 'line', data: { labels: hourlyLabels, datasets: [{ label: 'الإنتاج', data: hourlyData, backgroundColor: 'rgba(10, 179, 156, 0.2)', borderColor: '#0ab39c', borderWidth: 3, tension: 0.4, fill: true }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } } } });
            }

            let defectCounts = {}; todayScratches.forEach(d => { defectCounts[d.type] = (defectCounts[d.type] || 0) + 1; });
            
            // ---------------- تحليل باريتو (جديد) ----------------
            const paretoChartCanvas = document.getElementById('paretoChart');
            if(paretoChartCanvas) {
                if(this.charts.pareto) this.charts.pareto.destroy();
                
                // ترتيب العيوب من الأكبر للأصغر
                let sortedDefects = Object.keys(defectCounts).map(k => ({ type: k, count: defectCounts[k] })).sort((a, b) => b.count - a.count);
                let pLabels = sortedDefects.map(d => d.type);
                let pData = sortedDefects.map(d => d.count);
                
                // حساب النسبة التراكمية الخطية
                let cumulativePercent = [];
                let totalDefectsCount = pData.reduce((a, b) => a + b, 0);
                let currentSum = 0;
                
                if (totalDefectsCount > 0) {
                    pData.forEach(d => {
                        currentSum += d;
                        cumulativePercent.push(Math.round((currentSum / totalDefectsCount) * 100));
                    });
                }

                this.charts.pareto = new Chart(paretoChartCanvas.getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: pLabels.length ? pLabels : ['لا يوجد عيوب'],
                        datasets: [
                            { type: 'line', label: 'النسبة التراكمية %', data: cumulativePercent.length ? cumulativePercent : [0], borderColor: '#ef4444', backgroundColor: '#ef4444', borderWidth: 2, tension: 0.1, yAxisID: 'y1' },
                            { type: 'bar', label: 'تكرار العيب', data: pData.length ? pData : [0], backgroundColor: '#f59e0b', borderRadius: 4, yAxisID: 'y' }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        scales: {
                            y: { type: 'linear', position: 'left', beginAtZero: true },
                            y1: { type: 'linear', position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false } }
                        }
                    }
                });
            }

            let defectLabels = Object.keys(defectCounts); let defectData = Object.values(defectCounts);
            const defectsChartCanvas = document.getElementById('defectsChart');
            if (defectsChartCanvas) {
                if(this.charts.defects) this.charts.defects.destroy();
                this.charts.defects = new Chart(defectsChartCanvas.getContext('2d'), { type: 'doughnut', data: { labels: defectLabels.length ? defectLabels : ['سجل نظيف'], datasets: [{ data: defectData.length ? defectData : [1], backgroundColor: defectData.length ? ['#f59e0b', '#0ab39c', '#8b5cf6', '#ef4444', '#3b82f6'] : ['#f1f5f9'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { position: 'right' } } } });
            }
        } 
        else {
            // تحليلات المصنع بالكامل
            let factoryTotalActual = 0;
            let deptProd = {};
            let deptTargets = {};
            let globalScratches = {};
            let totalScratchesCount = 0;

            this.data.departments.forEach(d => { deptProd[d] = {}; deptTargets[d] = 0; });

            if(this.data.master.production) {
                this.data.master.production.forEach(r => {
                    if(r.department && this.data.departments.includes(r.department) && r.recordId && r.recordId.startsWith(r.department)) {
                        const val = Number(r.actual) || 0;
                        const hourPrefix = r.hour.split(':')[0]; 
                        deptProd[r.department][hourPrefix] = Math.max(deptProd[r.department][hourPrefix] || 0, val);
                    }
                });
            }

            if(this.data.master.targets) {
                this.data.master.targets.forEach(r => {
                    if(r.department && this.data.departments.includes(r.department)) {
                        deptTargets[r.department] = Number(r.target) || 0;
                    }
                });
            }

            if(this.data.master.scratches) {
                this.data.master.scratches.forEach(r => {
                    globalScratches[r.type] = (globalScratches[r.type] || 0) + 1;
                    totalScratchesCount++;
                });
            }

            let finalDeptProdTotals = {};
            this.data.departments.forEach(d => {
                const sum = Object.values(deptProd[d]).reduce((acc, val) => acc + val, 0);
                finalDeptProdTotals[d] = sum;
                if(d === 'التجميع النهائي') factoryTotalActual += sum; 
            });

            const facProdEl = document.getElementById('analytics-fac-prod');
            const facDefectsEl = document.getElementById('analytics-fac-defects');
            if(facProdEl) facProdEl.innerText = factoryTotalActual;
            if(facDefectsEl) facDefectsEl.innerText = totalScratchesCount;

            const depts = this.data.departments;
            const prodData = depts.map(d => finalDeptProdTotals[d]);
            const targetData = depts.map(d => deptTargets[d]);

            const facTargetChartCanvas = document.getElementById('facTargetChart');
            if(facTargetChartCanvas) {
                if(this.charts.facTarget) this.charts.facTarget.destroy();
                this.charts.facTarget = new Chart(facTargetChartCanvas.getContext('2d'), {
                    type: 'bar',
                    data: { labels: depts, datasets: [{ label: 'الفعلي', data: prodData, backgroundColor: '#0ab39c' }, { label: 'المستهدف', data: targetData, backgroundColor: '#cbd5e1' }] },
                    options: { responsive: true, maintainAspectRatio: false }
                });
            }

            const facDeptChartCanvas = document.getElementById('facDeptShareChart');
            if(facDeptChartCanvas) {
                if(this.charts.facDept) this.charts.facDept.destroy();
                this.charts.facDept = new Chart(facDeptChartCanvas.getContext('2d'), {
                    type: 'doughnut',
                    data: { labels: depts, datasets: [{ data: prodData, backgroundColor: ['#0ab39c', '#3b82f6', '#8b5cf6', '#f59e0b', '#64748b'] }] },
                    options: { responsive: true, maintainAspectRatio: false, cutout: '70%' }
                });
            }

            const facDefectChartCanvas = document.getElementById('facGlobalDefectsChart');
            if(facDefectChartCanvas) {
                const gDefectLabels = Object.keys(globalScratches);
                const gDefectData = Object.values(globalScratches);
                if(this.charts.facDefect) this.charts.facDefect.destroy();
                this.charts.facDefect = new Chart(facDefectChartCanvas.getContext('2d'), {
                    type: 'pie',
                    data: { labels: gDefectLabels.length ? gDefectLabels : ['سجل نظيف'], datasets: [{ data: gDefectData.length ? gDefectData : [1], backgroundColor: gDefectData.length ? ['#ef4444', '#f59e0b', '#8b5cf6', '#3b82f6', '#0ab39c'] : ['#f1f5f9'] }] },
                    options: { responsive: true, maintainAspectRatio: false }
                });
            }
        }
    },

    // ---------------- ملاحظات 5S ----------------
    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    },

    render5SDepartmentOptions() {
        const select = document.getElementById('5s-department');
        if (!select) return;
        const selected = select.value || this.data.currentDepartment || '';
        select.innerHTML = this.data.departments.length
            ? this.data.departments.map((dept) => `<option value="${this.escapeHtml(dept)}">${this.escapeHtml(dept)}</option>`).join('')
            : '<option value="">لا توجد أقسام</option>';
        if (this.data.departments.includes(selected)) select.value = selected;
    },

    get5SPlacesForDepartment(department) {
        return [...new Set(this.data.fiveS.locations.filter((item) => item.department === department).map((item) => item.place).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
    },

    render5SPlaceOptions() {
        const deptSelect = document.getElementById('5s-department');
        const placeSelect = document.getElementById('5s-place');
        if (!deptSelect || !placeSelect) return;
        const department = deptSelect.value || this.data.currentDepartment || '';
        const previous = placeSelect.value;
        const places = this.get5SPlacesForDepartment(department);
        placeSelect.innerHTML = places.length
            ? `<option value="">-- اختر المكان --</option>${places.map((place) => `<option value="${this.escapeHtml(place)}">${this.escapeHtml(place)}</option>`).join('')}`
            : '<option value="">أضف مكاناً جديداً أولاً</option>';
        if (places.includes(previous)) placeSelect.value = previous;
    },

    async add5SPlace() {
        const deptSelect = document.getElementById('5s-department');
        const input = document.getElementById('5s-new-place');
        const department = deptSelect ? deptSelect.value : '';
        const place = input ? input.value.trim() : '';
        if (!department || !place) { this.showToast('اختر القسم واكتب اسم المكان أولاً', true); return; }
        if (this.get5SPlacesForDepartment(department).includes(place)) { this.showToast('هذا المكان مضاف بالفعل', true); return; }
        const locations = [...this.data.fiveS.locations, { department, place, createdAt: new Date().toISOString() }];
        try {
            await API.fiveS.saveLocations(locations);
            this.data.fiveS.locations = locations;
            this.render5SPlaceOptions();
            const placeSelect = document.getElementById('5s-place');
            if (placeSelect) placeSelect.value = place;
            if (input) input.value = '';
            this.showToast('تم حفظ المكان بنجاح ✅');
        } catch (error) { this.showToast('تعذر حفظ المكان، حاول مرة أخرى', true); }
    },

    compress5SImage(file) {
        return new Promise((resolve, reject) => {
            if (!file) return resolve(null);
            if (!file.type || !file.type.startsWith('image/')) return reject(new Error('invalid_image'));
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('read_error'));
            reader.onload = (event) => {
                const image = new Image();
                image.onerror = () => reject(new Error('image_error'));
                image.onload = () => {
                    let width = image.width;
                    let height = image.height;
                    if (width > height && width > CONFIG.IMAGE_MAX_WIDTH) {
                        height *= CONFIG.IMAGE_MAX_WIDTH / width;
                        width = CONFIG.IMAGE_MAX_WIDTH;
                    } else if (height >= width && height > CONFIG.IMAGE_MAX_HEIGHT) {
                        width *= CONFIG.IMAGE_MAX_HEIGHT / height;
                        height = CONFIG.IMAGE_MAX_HEIGHT;
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(width));
                    canvas.height = Math.max(1, Math.round(height));
                    const context = canvas.getContext('2d', { alpha: false });
                    context.drawImage(image, 0, 0, canvas.width, canvas.height);
                    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('compression_error')), 'image/webp', CONFIG.IMAGE_QUALITY);
                };
                image.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    },

    async upload5SImage(file, noteId, date, kind) {
        if (!file) return null;
        const blob = await this.compress5SImage(file);
        return API.fiveS.uploadImage(blob, `5s/${date}/${noteId}/${kind}.webp`, CONFIG.GOOGLE_API_URL);
    },

    async add5SCorrectiveImage(noteId, file) {
        if (!file) return;
        const note = (this.data.fiveS.notes || []).find((item) => item.id === noteId);
        if (!note) { this.showToast('تعذر العثور على الملاحظة', true); return; }
        const loader = document.getElementById('upload-loader');
        const loaderText = document.getElementById('loader-text');
        if (loader) loader.classList.add('show');
        if (loaderText) loaderText.innerText = 'جاري رفع صورة الفعل التصحيحي...';
        try {
            const corrective = await this.upload5SImage(file, noteId, note.date, 'corrective');
            await API.fiveS.saveNote({ id: noteId, correctiveImagePath: corrective.path, correctiveImageUrl: corrective.url, updatedAtClient: new Date().toISOString() });
            this.showToast('تم توثيق الفعل التصحيحي ✅');
        } catch (error) {
            console.error('5S corrective upload error:', error);
            this.showToast('تعذر رفع صورة الفعل التصحيحي', true);
        } finally {
            if (loader) loader.classList.remove('show');
            if (loaderText) loaderText.innerText = 'جاري المعالجة...';
        }
    },

    async add5SNote() {
        if (!this.isOnline) { this.showToast('لا يوجد اتصال بالسحابة حالياً', true); return; }
        const department = document.getElementById('5s-department')?.value || '';
        const place = document.getElementById('5s-place')?.value || '';
        const description = document.getElementById('5s-description')?.value.trim() || '';
        const observationFile = document.getElementById('5s-observation-image')?.files?.[0];
        const correctiveFile = document.getElementById('5s-corrective-image')?.files?.[0];
        const date = document.getElementById('global-date')?.value || '';
        if (!department || !place) { this.showToast('اختر القسم والمكان أولاً', true); return; }
        if (!observationFile) { this.showToast('صورة الملاحظة مطلوبة', true); return; }
        if (!description) { this.showToast('اكتب وصف الملاحظة أولاً', true); return; }

        const noteId = `5s_${date}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const loader = document.getElementById('upload-loader');
        const loaderText = document.getElementById('loader-text');
        if (loader) loader.classList.add('show');
        if (loaderText) loaderText.innerText = 'جاري ضغط ورفع صور 5S...';
        try {
            const [observation, corrective] = await Promise.all([
                this.upload5SImage(observationFile, noteId, date, 'observation'),
                this.upload5SImage(correctiveFile, noteId, date, 'corrective')
            ]);
            const note = {
                id: noteId,
                date,
                monthKey: date.slice(0, 7),
                department,
                place,
                description,
                observationImagePath: observation?.path || '',
                observationImageUrl: observation?.url || '',
                correctiveImagePath: corrective?.path || '',
                correctiveImageUrl: corrective?.url || '',
                createdAt: new Date().toISOString(),
                updatedAtClient: new Date().toISOString()
            };
            await API.fiveS.saveNote(note);
            ['5s-observation-image', '5s-corrective-image'].forEach((id) => { const input = document.getElementById(id); if (input) input.value = ''; });
            const descriptionInput = document.getElementById('5s-description');
            if (descriptionInput) descriptionInput.value = '';
            this.showToast('تم حفظ ملاحظة 5S بنجاح ✅');
        } catch (error) {
            console.error('5S upload error:', error);
            this.showToast('تعذر حفظ الملاحظة أو الصور، راجع إعدادات Google Drive', true);
        } finally {
            if (loader) loader.classList.remove('show');
            if (loaderText) loaderText.innerText = 'جاري المعالجة...';
        }
    },

    render5SNotes() {
        const container = document.getElementById('5s-notes-list');
        if (!container) return;
        const date = document.getElementById('global-date')?.value || '';
        const dateLabel = document.getElementById('5s-selected-date-label');
        if (dateLabel) dateLabel.innerText = date;
        const notes = (this.data.fiveS.notes || []).filter((note) => note.date === date);
        const total = notes.length;
        const corrective = notes.filter((note) => note.correctiveImagePath || note.correctiveImageUrl).length;
        const totalEl = document.getElementById('5s-total-notes');
        const correctiveEl = document.getElementById('5s-total-corrective');
        const rateEl = document.getElementById('5s-completion-rate');
        if (totalEl) totalEl.innerText = total;
        if (correctiveEl) correctiveEl.innerText = corrective;
        if (rateEl) rateEl.innerText = `${total ? Math.round((corrective / total) * 100) : 0}%`;

        if (!notes.length) {
            container.innerHTML = '<div class="card s5-empty"><i class="fa-solid fa-clipboard-check text-teal" style="font-size:2rem; margin-bottom:10px;"></i><div>لا توجد ملاحظات 5S لهذا اليوم</div></div>';
            this.render5SAnalytics(notes);
            this.render5SArchive();
            return;
        }

        const grouped = {};
        notes.forEach((note) => {
            const key = `${note.department}|||${note.place}`;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(note);
        });
        container.innerHTML = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b, 'ar')).map(([key, group]) => {
            const [department, place] = key.split('|||');
            const groupCorrective = group.filter((note) => note.correctiveImagePath || note.correctiveImageUrl).length;
            const cards = group.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).map((note) => {
                const observationUrl = this.escapeHtml(this.getImageUrl(note.observationImageUrl || note.observationImagePath || ''));
                const correctiveUrl = this.escapeHtml(this.getImageUrl(note.correctiveImageUrl || note.correctiveImagePath || ''));
                const noteId = this.escapeHtml(note.id || '');
                const observationHtml = observationUrl ? `<div class="s5-image-frame"><img src="${observationUrl}" onclick="App.openImage(this.src)" alt="صورة الملاحظة"><span class="s5-image-label">صورة الملاحظة</span></div>` : '<div class="s5-image-frame s5-no-image"><i class="fa-solid fa-image"></i><span>لا توجد صورة</span></div>';
                const correctiveHtml = correctiveUrl ? `<div class="s5-image-frame"><img src="${correctiveUrl}" onclick="App.openImage(this.src)" alt="صورة الفعل التصحيحي"><span class="s5-image-label">الفعل التصحيحي</span></div>` : `<div class="s5-image-frame s5-no-image"><i class="fa-solid fa-hourglass-half"></i><label class="s5-corrective-upload"><input type="file" accept="image/*" capture="environment" onchange="App.add5SCorrectiveImage('${noteId}', this.files[0])"><span>رفع الفعل التصحيحي</span></label></div>`;
                const time = note.createdAt ? new Date(note.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '';
                return `<div class="card s5-note-card"><div class="s5-note-images">${observationHtml}${correctiveHtml}</div><div class="s5-note-meta"><span><i class="fa-solid fa-clock"></i> ${this.escapeHtml(time)}</span><span class="defect-badge ${correctiveUrl ? 'fixed' : 'pending'}">${correctiveUrl ? 'تم التوثيق' : 'بانتظار الفعل التصحيحي'}</span></div><p class="s5-note-description">${this.escapeHtml(note.description)}</p></div>`;
            }).join('');
            return `<div class="card s5-location-group"><div class="s5-location-title"><h4><i class="fa-solid fa-location-dot text-teal"></i> ${this.escapeHtml(place)}</h4><span>${this.escapeHtml(department)} · ${group.length} ملاحظة · ${groupCorrective} مكتملة</span></div>${cards}</div>`;
        }).join('');
        this.render5SAnalytics(notes);
        this.render5SArchive();
    },

    render5SArchive() {
        const container = document.getElementById('5s-monthly-archive');
        if (!container) return;
        const summaries = [...(this.data.fiveS.monthlySummaries || [])].sort((a, b) => String(b.monthKey || b.id).localeCompare(String(a.monthKey || a.id)));
        if (!summaries.length) {
            container.innerHTML = '<div class="s5-empty">لا يوجد أرشيف شهري حتى الآن</div>';
            return;
        }
        container.innerHTML = summaries.map((summary) => {
            const locations = Array.isArray(summary.locations) ? summary.locations : [];
            const rows = locations.length ? locations.map((location) => `<div class="s5-archive-row"><span><strong>${this.escapeHtml(location.place)}</strong><small>${this.escapeHtml(location.department)}</small></span><span>${Number(location.totalNotes) || 0} ملاحظة</span><span class="${Number(location.correctiveNotes) > 0 ? 'text-teal' : 'text-muted'}">${Number(location.correctiveNotes) || 0} فعل تصحيحي</span></div>`).join('') : '<div class="s5-empty">لا توجد تفاصيل للأماكن</div>';
            return `<div class="s5-archive-month"><div class="s5-archive-header"><strong>${this.escapeHtml(summary.monthKey || summary.id)}</strong><span>${Number(summary.totalNotes) || 0} ملاحظة · ${Number(summary.correctiveNotes) || 0} مكتملة · ${Number(summary.completionRate) || 0}%</span></div>${rows}</div>`;
        }).join('');
    },

    render5SAnalytics(notes) {
        if (typeof Chart === 'undefined') return;
        const grouped = {};
        notes.forEach((note) => {
            const label = `${note.department} - ${note.place}`;
            if (!grouped[label]) grouped[label] = { total: 0, corrective: 0 };
            grouped[label].total++;
            if (note.correctiveImagePath || note.correctiveImageUrl) grouped[label].corrective++;
        });
        const labels = Object.keys(grouped);
        const totals = labels.map((label) => grouped[label].total);
        const corrections = labels.map((label) => grouped[label].corrective);
        const emptyLabels = labels.length ? labels : ['لا توجد بيانات'];
        const emptyTotals = totals.length ? totals : [0];
        const placeChart = document.getElementById('5s-notes-by-place-chart');
        if (placeChart) {
            if (this.charts.fiveSPlaces) this.charts.fiveSPlaces.destroy();
            this.charts.fiveSPlaces = new Chart(placeChart.getContext('2d'), { type: 'doughnut', data: { labels: emptyLabels, datasets: [{ data: emptyTotals, backgroundColor: labels.length ? ['#0ab39c', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#64748b'] : ['#e2e8f0'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'bottom' } } } });
        }
        const correctionChart = document.getElementById('5s-correction-by-place-chart');
        if (correctionChart) {
            if (this.charts.fiveSCorrections) this.charts.fiveSCorrections.destroy();
            this.charts.fiveSCorrections = new Chart(correctionChart.getContext('2d'), { type: 'bar', data: { labels: emptyLabels, datasets: [{ label: 'إجمالي الملاحظات', data: emptyTotals, backgroundColor: '#cbd5e1', borderRadius: 5 }, { label: 'بصورة فعل تصحيحي', data: labels.length ? corrections : [0], backgroundColor: '#0ab39c', borderRadius: 5 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { ticks: { autoSkip: false, maxRotation: 45, minRotation: 0 } } } } });
        }
    },

    // ---------------- التصدير (Excel & PDF) ----------------
    exportToExcel() {
        this.showToast('جاري تحضير ملف الإكسيل...');
        
        let ws_data = [
            ["نظام الإنتاج الموحد - تقرير المصنع"],
            ["التاريخ:", document.getElementById('global-date').value],
            ["الوردية:", document.getElementById('global-shift').value],
            [],
            ["القسم", "الإنتاج الفعلي", "المستهدف"]
        ];

        let finalDeptProdTotals = {};
        this.data.departments.forEach(d => {
            let deptSum = 0;
            if(this.data.master.production) {
                this.data.master.production.forEach(r => {
                    if(r.department === d && r.recordId && r.recordId.startsWith(d)) {
                        const val = Number(r.actual) || 0;
                        const hourPrefix = r.hour.split(':')[0]; 
                        finalDeptProdTotals[d] = finalDeptProdTotals[d] || {};
                        finalDeptProdTotals[d][hourPrefix] = Math.max(finalDeptProdTotals[d][hourPrefix] || 0, val);
                    }
                });
                deptSum = Object.values(finalDeptProdTotals[d] || {}).reduce((acc, val) => acc + val, 0);
            }

            let deptTarget = 0;
            if(this.data.master.targets) {
                this.data.master.targets.forEach(r => { if(r.department === d) deptTarget = Number(r.target) || 0; });
            }

            ws_data.push([d, deptSum, deptTarget]);
        });

        ws_data.push([], ["سجل العيوب العام"], ["القسم", "نوع العيب", "الحالة", "ملاحظات", "الوقت"]);
        if(this.data.master.scratches) {
            this.data.master.scratches.forEach(d => {
                ws_data.push([d.department, d.type, d.status === 'fixed' ? 'تم الإصلاح' : 'قيد الإصلاح', d.notes, d.time]);
            });
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(ws_data);
        XLSX.utils.book_append_sheet(wb, ws, "تقرير المصنع");
        XLSX.writeFile(wb, `Factory_Report_${document.getElementById('global-date').value}.xlsx`);
        this.showToast('تم التحميل بنجاح ✅');
    },

    exportToPDF() {
        this.showToast('جاري تصدير الـ PDF... يرجى الانتظار');
        const element = document.getElementById('main-content-area'); // تصدير محتوى الشاشة الحالي
        
        const opt = {
          margin:       0.5,
          filename:     `Report_${document.getElementById('global-date').value}.pdf`,
          image:        { type: 'jpeg', quality: 0.98 },
          html2canvas:  { scale: 2, useCORS: true },
          jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' }
        };

        html2pdf().set(opt).from(element).save().then(() => {
            this.showToast('تم التحميل بنجاح ✅');
        });
    },

    sendWhatsAppReport() {
        const globalDateEl = document.getElementById('global-date');
        const globalShiftEl = document.getElementById('global-shift');
        if (!globalDateEl || !globalShiftEl) return;

        let dParts = globalDateEl.value.split('-'); let formattedDate = `${dParts[2]}-${dParts[1]}-${dParts[0]}`; 
        let total = 0; let report = `*تقرير الإنتاج (${this.data.currentDepartment})*\nالخط: ${this.data.settings.lineName}\nالتاريخ: ${formattedDate}\nالوردية: ${globalShiftEl.value}\n\n`; 
        
        document.querySelectorAll('.hour-row').forEach(row => {
            if(row.classList.contains('break-row')) { report += `\n*فترة راحة*\n\n`; } 
            else {
                const labelEl = row.querySelector('.time-label'); const actualEl = row.querySelector('.actual-input'); const reasonEl = row.querySelector('.reason-input');
                if (labelEl && actualEl) {
                    const label = labelEl.innerText; const actual = actualEl.value || "0";
                    report += `${label} : ${actual}\n`;
                    if(reasonEl && reasonEl.value.trim() !== '') report += `- ${reasonEl.value.trim()}\n`;
                    total += Number(actual);
                }
            }
        });

        report += `\n*إجمالي الإنتاج: ${total}*`;
        window.open(`https://wa.me/?text=${encodeURIComponent(report)}`, '_blank');
    },
async installPWA() {
        if (this.deferredPrompt) {
            this.deferredPrompt.prompt();
            const { outcome } = await this.deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                const installBanner = document.getElementById('install-banner');
                if (installBanner) installBanner.style.display = 'none';
            }
            this.deferredPrompt = null;
        }
    },
    // --- دالة إطلاق الإشعارات الصوتية والنصية ---
    showSystemNotification(title, body) {
        if ('Notification' in window && Notification.permission === 'granted') {
            const notification = new Notification(title, {
                body: body,
                icon: 'https://cdn-icons-png.flaticon.com/512/2804/2804364.png',
                vibrate: [200, 100, 200]
            });
            // تشغيل صوت تنبيه بسيط (اختياري)
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            audio.play().catch(e => console.log('Audio blocked by browser'));
        }
    },
    hardReset() {
        if(confirm("تحذير: سيتم مسح الإعدادات المحلية! هل أنت متأكد؟")) { localStorage.removeItem(CONFIG.STORAGE_KEY); location.reload(); }
    }
};

window.App = App; document.addEventListener('DOMContentLoaded', () => App.init());
