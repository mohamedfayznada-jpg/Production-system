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
    currentBalanceListener: null,
    
    isOnline: true,
    saveTimers: {},
    charts: {},
    currentScreen: 'home',
    currentBalanceTab: 'cabinet', 
    
    data: {
        departments: [],
        currentDepartment: '',
        settings: { start: '07:30', end: '16:00', bStart: '12:30', bEnd: '13:30', lineName: 'التجميع النهائي', defectTypes: ['خدش خفيف'] },
        generatedHours: [],
        scratches: [],
        balances: { cabinet: { initial: '', added: '', consumed: '' }, door: { initial: '', added: '', consumed: '' }, accessories: { initial: '', added: '', consumed: '' } },
        master: { production: [], targets: [], scratches: [] }
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
        
        const globalDate = document.getElementById('global-date');
        const globalShift = document.getElementById('global-shift');
        
        if (globalDate) globalDate.value = dateString;
        if (globalShift) globalShift.value = "1";

        this.systemListenerUnsubscribe = API.system.listenToDepartments((depts) => {
            this.data.departments = depts;
            this.renderDepartmentSelector();
            this.renderSettingsDepartmentsList();
            
            if(!this.data.currentDepartment && depts.length > 0) {
                this.data.currentDepartment = depts[0];
                const deptSelect = document.getElementById('global-department');
                if (deptSelect) deptSelect.value = this.data.currentDepartment;
                this.listenToCurrentDepartmentSettings();
            }
        });

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

    // ---------------- الإنتاج والتارجت ----------------
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

        if (this.currentProdListener) this.currentProdListener();
        if (this.currentDefectListener) this.currentDefectListener();
        if (this.masterProdListener) this.masterProdListener();
        if (this.masterTargetListener) this.masterTargetListener();
        if (this.masterDefectListener) this.masterDefectListener();
        if (this.currentBalanceListener) this.currentBalanceListener();

        this.clearInputs();

        // Target Listener
        API.production.listenToTarget(this.data.currentDepartment, date, shift, (targetVal) => {
            const tInput = document.getElementById('prod-target');
            if(tInput && document.activeElement !== tInput) tInput.value = targetVal || '';
        });

        // Current Dept Production
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

        // Current Dept Scratches
        this.currentDefectListener = API.quality.listenToDefects(this.data.currentDepartment, date, (records) => {
            this.data.scratches = records;
            this.renderScratchesList();
            if(this.currentScreen === 'analytics') this.renderAnalytics();
        });

        // Master Dashboard Listeners
        this.masterProdListener = API.master.listenToAllProduction(date, shift, (records) => {
            this.data.master.production = records;
            if(this.currentScreen === 'home') this.renderMasterDashboard();
        });
        this.masterTargetListener = API.master.listenToAllTargets(date, shift, (records) => {
            this.data.master.targets = records;
            if(this.currentScreen === 'home') this.renderMasterDashboard();
        });
        this.masterDefectListener = API.master.listenToAllScratches(date, (records) => {
            this.data.master.scratches = records;
            if(this.currentScreen === 'home') this.renderMasterDashboard();
        });

        // Balances
        this.currentBalanceListener = API.balances.listenToBalances(this.data.currentDepartment, (balancesData) => {
            this.data.balances = { cabinet: { initial: '', added: '', consumed: '' }, door: { initial: '', added: '', consumed: '' }, accessories: { initial: '', added: '', consumed: '' } };
            balancesData.forEach(b => { if(this.data.balances[b.type]) this.data.balances[b.type] = b; });
            this.populateBalanceInputs();
        });
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

        // 1. فلترة وتجميع الإنتاج 
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

        // 2. فلترة وتجميع التارجت
        let validTargets = {};
        if(this.data.master.targets) {
            this.data.master.targets.forEach(r => {
                if(r.department && this.data.departments.includes(r.department)) {
                    validTargets[r.department] = Number(r.target) || 0;
                }
            });
        }
        
        // التعديل الجديد: المستهدف الكلي للمصنع هو فقط مستهدف قسم التجميع النهائي
        factoryTotalTarget = validTargets['التجميع النهائي'] || 0;

        // 3. فلترة عيوب الرش
        if(this.data.master.scratches) {
            this.data.master.scratches.forEach(r => {
                if(r.department && deptScratches[r.department] !== undefined) {
                    deptScratches[r.department] += 1;
                }
            });
        }

        // 4. الحساب النهائي
        let finalDeptProdTotals = {};
        this.data.departments.forEach(d => {
            const sum = Object.values(deptProd[d]).reduce((acc, val) => acc + val, 0);
            finalDeptProdTotals[d] = sum;
            
            // التعديل الجديد: مخرجات المصنع تحسب فقط من قسم التجميع النهائي
            if (d === 'التجميع النهائي') {
                factoryTotalActual += sum; 
            }
        });

        // 5. تحديث الشاشة
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
                options: { 
                    responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
                    onClick: (e, elements) => {
                        if(elements.length > 0) {
                            const deptIndex = elements[0].index;
                            this.switchToDepartmentAndGo(depts[deptIndex], 'analytics');
                        }
                    }
                } 
            });
        }

        const defectsChartCanvas = document.getElementById('masterDefectsChart');
        if (defectsChartCanvas) {
            if(this.charts.masterDefects) this.charts.masterDefects.destroy(); 
            this.charts.masterDefects = new Chart(defectsChartCanvas.getContext('2d'), { 
                type: 'bar', 
                data: { labels: depts, datasets: [{ label: 'عيوب الرش', data: scratchData, backgroundColor: '#f59e0b', borderRadius: 4 }] }, 
                options: { 
                    responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
                    onClick: (e, elements) => {
                        if(elements.length > 0) {
                            const deptIndex = elements[0].index;
                            this.switchToDepartmentAndGo(depts[deptIndex], 'scratches');
                        }
                    }
                } 
            });
        }
    },

    // ---------------- Balances ----------------
    switchBalanceTab(tabId) {
        this.currentBalanceTab = tabId;
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.querySelector(`.tab-btn[onclick="App.switchBalanceTab('${tabId}')"]`);
        if(activeBtn) activeBtn.classList.add('active');
        this.populateBalanceInputs();
    },
    populateBalanceInputs() {
        const currentData = this.data.balances[this.currentBalanceTab];
        const initialEl = document.getElementById('balance-initial');
        const addedEl = document.getElementById('balance-added');
        const consumedEl = document.getElementById('balance-consumed');

        if(initialEl) initialEl.value = currentData.initial || '';
        if(addedEl) addedEl.value = currentData.added || '';
        if(consumedEl) consumedEl.value = currentData.consumed || '';
        this.calculateCurrentBalance();
    },
    calculateCurrentBalance() {
        const initial = Number(document.getElementById('balance-initial')?.value) || 0;
        const added = Number(document.getElementById('balance-added')?.value) || 0;
        const consumed = Number(document.getElementById('balance-consumed')?.value) || 0;
        const currentEl = document.getElementById('balance-current');
        if(currentEl) currentEl.innerText = (initial + added) - consumed;
    },
    async saveCurrentBalance() {
        if(!this.isOnline) { this.showToast("تأكد من الاتصال", true); return; }
        const payload = { 
            initial: document.getElementById('balance-initial')?.value || '', 
            added: document.getElementById('balance-added')?.value || '', 
            consumed: document.getElementById('balance-consumed')?.value || '' 
        };
        try {
            await API.balances.saveBalance(this.data.currentDepartment, this.currentBalanceTab, payload);
            this.showToast("تم تحديث الرصيد بنجاح ✅");
        } catch(e) { this.showToast("فشل تحديث الرصيد", true); }
    },

    // ---------------- Defect Types & Scratches ----------------
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
        const typeEl = document.getElementById('scratch-type');
        const notesEl = document.getElementById('scratch-notes');
        const fileInput = document.getElementById('scratch-image');
        const dateEl = document.getElementById('global-date');
        
        if (!typeEl || !dateEl) return;

        const date = dateEl.value;
        const defectBase = {
            id: Date.now(), type: typeEl.value, notes: notesEl ? notesEl.value : '', 
            status: 'pending', time: new Date().toLocaleTimeString('ar-EG', {hour: '2-digit', minute:'2-digit'}), 
            date: date
        };

        if(!fileInput || !fileInput.files || !fileInput.files[0]) { 
            defectBase.image = "";
            API.quality.saveDefect(this.data.currentDepartment, defectBase);
            if(notesEl) notesEl.value = ''; 
            this.showToast("تم التسجيل والمزامنة بدون صورة ✅");
            return; 
        }

        if(CONFIG.GOOGLE_API_URL === '') { this.showToast("رابط الرفع غير موجود", true); return; }

        const loader = document.getElementById('upload-loader'); 
        if(loader) loader.classList.add('show'); 
        
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
                        await API.quality.saveDefect(this.data.currentDepartment, defectBase);
                        if(notesEl) notesEl.value = ''; 
                        if(fileInput) fileInput.value = ''; 
                        App.showToast("تم الرفع والتسجيل بنجاح ✅");
                    } else { App.showToast("فشل الرفع السحابي للصورة ❌", true); }
                } catch (err) { App.showToast("خطأ شبكة أثناء الرفع ❌", true); } 
                finally { if(loader) loader.classList.remove('show'); }
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    },

    renderScratchesList() {
        const container = document.getElementById('scratches-list'); 
        if(!container) return;
        container.innerHTML = '';
        let countToday = 0; let countFixed = 0; let countPending = 0;
        
        this.data.scratches.forEach(d => {
            countToday++;
            if (d.status === 'pending') countPending++;
            if (d.status === 'fixed') countFixed++; 
        });

        const qcToday = document.getElementById('qc-count-today');
        const qcFixed = document.getElementById('qc-count-fixed');
        const qcPending = document.getElementById('qc-count-pending');

        if(qcToday) qcToday.innerText = countToday;
        if(qcFixed) qcFixed.innerText = countFixed;
        if(qcPending) qcPending.innerText = countPending;

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
        API.quality.saveDefect(this.data.currentDepartment, { id: id, status: newStatus });
    },
    
    deleteScratch(id) { 
        if(confirm("مسح السجل نهائياً؟")) API.quality.deleteDefect(id);
    },

    openImage(src) { 
        const modalImg = document.getElementById('modal-image');
        const modal = document.getElementById('image-modal');
        if(modalImg && modal) {
            modalImg.src = src; modal.classList.add('show'); 
        }
    },
    closeImageModal(e) { 
        const modal = document.getElementById('image-modal');
        if(modal && (e.target.id === 'image-modal' || e.target.classList.contains('fa-xmark') || e.target.classList.contains('close-modal-btn'))) {
            modal.classList.remove('show'); 
        }
    },

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
        if(totalDefectsEl) totalDefectsEl.innerText = this.data.scratches.length;

        Chart.defaults.font.family = 'Cairo';
        Chart.defaults.color = '#94a3b8';

        const prodChartCanvas = document.getElementById('prodChart');
        if (prodChartCanvas) {
            if(this.charts.prod) this.charts.prod.destroy(); 
            this.charts.prod = new Chart(prodChartCanvas.getContext('2d'), { 
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
        }

        let defectCounts = {}; this.data.scratches.forEach(d => { defectCounts[d.type] = (defectCounts[d.type] || 0) + 1; });
        let defectLabels = Object.keys(defectCounts); let defectData = Object.values(defectCounts);
        
        const defectsChartCanvas = document.getElementById('defectsChart');
        if (defectsChartCanvas) {
            if(this.charts.defects) this.charts.defects.destroy();
            this.charts.defects = new Chart(defectsChartCanvas.getContext('2d'), { 
                type: 'doughnut', 
                data: { labels: defectLabels.length ? defectLabels : ['سجل نظيف'], datasets: [{ data: defectData.length ? defectData : [1], backgroundColor: defectData.length ? ['#f59e0b', '#0ab39c', '#8b5cf6', '#ef4444', '#3b82f6'] : ['#f1f5f9'], borderWidth: 0 }] }, 
                options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { position: 'right' } } } 
            });
        }
    },

    sendWhatsAppReport() {
        const globalDateEl = document.getElementById('global-date');
        const globalShiftEl = document.getElementById('global-shift');
        if (!globalDateEl || !globalShiftEl) return;

        let dParts = globalDateEl.value.split('-'); 
        let formattedDate = `${dParts[2]}-${dParts[1]}-${dParts[0]}`; 
        let total = 0; 
        let report = `*تقرير الإنتاج (${this.data.currentDepartment})*\nالخط: ${this.data.settings.lineName}\nالتاريخ: ${formattedDate}\nالوردية: ${globalShiftEl.value}\n\n`; 
        
        document.querySelectorAll('.hour-row').forEach(row => {
            if(row.classList.contains('break-row')) {
                report += `\n*فترة راحة*\n\n`;
            } else {
                const labelEl = row.querySelector('.time-label');
                const actualEl = row.querySelector('.actual-input');
                const reasonEl = row.querySelector('.reason-input');
                
                if (labelEl && actualEl) {
                    const label = labelEl.innerText;
                    const actual = actualEl.value || "0";
                    report += `${label} : ${actual}\n`;
                    if(reasonEl && reasonEl.value.trim() !== '') report += `- ${reasonEl.value.trim()}\n`;
                    total += Number(actual);
                }
            }
        });

        report += `\n*إجمالي الإنتاج: ${total}*`;
        window.open(`https://wa.me/?text=${encodeURIComponent(report)}`, '_blank');
    },

    hardReset() {
        if(confirm("تحذير: سيتم مسح الإعدادات المحلية للمتصفح! هل أنت متأكد؟")) {
            localStorage.removeItem(CONFIG.STORAGE_KEY);
            location.reload();
        }
    }
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
