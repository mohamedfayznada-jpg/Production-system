/**
 * MES CORE V28.0 - Master BI Drill-Down Edition
 * Includes: Multi-Level Analytics, Excel Export, Event Listeners
 */

const MES = {
    Config: {
        supabaseUrl: 'https://xaqqbxtxkzximwsnwezw.supabase.co',
        supabaseKey: 'sb_publishable_F-NNQh4BT3lpEgHIszFCvg_ZJvCmERP',
        time: { sStart: '08:00', sEnd: '16:00', bStart: '12:00', bEnd: '12:45' },
        defaultSchema: {
            "النظافة والمظهر": ["عفرة دهان", "رايش", "حصوة", "نظافة كاب"],
            "التبريد واللحام": ["تسريب", "سدد", "خفس مواسير"],
            "الكهرباء": ["عيب كباس", "NG سخان", "NG مروحة"],
            "الحقن والفوم": ["تسريب فوم", "نقص حقن", "شفط فوم"],
            "التجميع والضبط": ["خلوص جوان", "مسافة أبواب", "عيب تجميع"]
        },
        coolingMaster: {
            defectTypes: { "تجميع ابتدائي": ["تسريب", "سدد", "خفس"], "تجميع نهائي": ["تسريب", "سدد", "خفس", "عيوب منوعة"] },
            points: ["نقطة (1)", "نقطة (2)", "نقطة (3)", "نقطة (4)", "نقطة (8)"],
            miscDefects: ["شحنة زائدة", "بدون شحنة", "عيب كباس", "نقص شحنه"],
            stamps: { "2": "ابراهيم زكى", "6": "محمد رشدى", "9": "احمد راضى", "17": "محمد فايز" }
        }
    },

    State: {
        current: { date: "", shift: "1", target: 0, intervals: [], currentDocId: "" },
        defectSchema: {}, monitor: { foaming: [], cooling: [], ole: {} },
        init() {
            const todayStr = new Date().toISOString().split('T')[0];
            this.current.date = todayStr; this.current.currentDocId = `${todayStr}_Shift_${this.current.shift}`;
            ['quickDate', 'foamDateSelector', 'coolingDateSelector', 'oleDateSelector'].forEach(id => { const el = document.getElementById(id); if(el) el.value = todayStr; });
        },
        persist() { localStorage.setItem('mes_core_state', JSON.stringify(this.current)); MES.API.syncShiftToCloud(); },
        load() { const saved = JSON.parse(localStorage.getItem('mes_core_state') || '{}'); if (saved.date === this.current.date) { this.current = { ...this.current, ...saved }; const qt = document.getElementById('quickTarget'); if(qt) qt.value = this.current.target; } }
    },

    API: {
        client: null,
        init() { try { this.client = supabase.createClient(MES.Config.supabaseUrl, MES.Config.supabaseKey); } catch (e) { console.error("API Error", e); } },
        async syncShiftToCloud() {
            if(!this.client || MES.State.current.intervals.length === 0) return;
            await this.client.from('production_shifts').upsert({ shift_id: MES.State.current.currentDocId, shift_data: { intervals: MES.State.current.intervals, config: { totalTarget: MES.State.current.target } }, updated_at: new Date().toISOString() });
        },
        async loadSchemaFromCloud() {
            if(!this.client) { MES.State.defectSchema = MES.Config.defaultSchema; return; }
            try {
                const { data } = await this.client.from('production_shifts').select('shift_data').eq('shift_id', 'CONFIG_DEFECT_SCHEMA').maybeSingle();
                if(data && data.shift_data && data.shift_data.schema) { MES.State.defectSchema = data.shift_data.schema; }
                else { MES.State.defectSchema = MES.Config.defaultSchema; this.syncSchemaToCloud(); }
            } catch(e) { MES.State.defectSchema = MES.Config.defaultSchema; }
        },
        async syncSchemaToCloud() {
            if(!this.client) return;
            await this.client.from('production_shifts').upsert({ shift_id: 'CONFIG_DEFECT_SCHEMA', shift_data: { schema: MES.State.defectSchema }, updated_at: new Date().toISOString() });
        },
        async syncMonitorDoc(type, date, shift, payload) {
            if(!this.client) return;
            let docId = type === 'foaming' ? `${date}_FOAMING` : (type === 'cooling' ? `${date}_COOLING_${shift}` : `${date}_OLE_${shift}`);
            let dataPacket = (type === 'ole') ? { data: payload } : { records: payload };
            await this.client.from('production_shifts').upsert({ shift_id: docId, shift_data: { type: type, ...dataPacket }, updated_at: new Date().toISOString() });
        }
    },

    Production: {
        timeToMins(t) { let [h, m] = t.split(':').map(Number); return h * 60 + m; },
        formatAMPM(mins) { mins = mins % (24 * 60); let h = Math.floor(mins / 60); let m = (mins % 60).toString().padStart(2, '0'); let ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h.toString().padStart(2, '0')}:${m} <span style="font-size:0.7rem; color:var(--text-secondary);">${ampm}</span>`; },
        updateTarget(newTarget) {
            MES.State.current.target = newTarget; const conf = MES.Config.time;
            const startM = this.timeToMins(conf.sStart); let endM = this.timeToMins(conf.sEnd); const bStartM = this.timeToMins(conf.bStart); let bEndM = this.timeToMins(conf.bEnd);
            if (endM <= startM) endM += 24 * 60; if (bEndM <= bStartM) bEndM += 24 * 60;
            const netMins = (endM - startM) - (bEndM - bStartM); if (netMins <= 0) return;
            const upm = newTarget > 0 ? (newTarget / netMins) : 0; let current = startM; let intervals = []; let acc = 0;

            while (current < endM) {
                if (current === bStartM) { intervals.push({ isBreak: true, start: bStartM, end: bEndM, duration: bEndM - bStartM }); current = bEndM; continue; }
                let iEnd = current + 60; if (current < bStartM && iEnd > bStartM) iEnd = bStartM; if (iEnd > endM) iEnd = endM;
                let dur = iEnd - current; let rt = Math.round(upm * dur);
                intervals.push({ isBreak: false, start: current, end: iEnd, duration: dur, target: rt, actual: "", defects: [] });
                acc += rt; current = iEnd;
            }
            let diff = newTarget - acc;
            for (let i = intervals.length - 1; i >= 0 && diff !== 0; i--) { if (!intervals[i].isBreak) { let step = diff > 0 ? 1 : -1; if (intervals[i].target + step >= 0) { intervals[i].target += step; diff -= step; if (diff !== 0) i++; } } }
            MES.State.current.intervals = intervals; MES.State.persist(); MES.UI.renderAll();
        },
     saveActual(idx, val) { 
    MES.State.current.intervals[idx].actual = val === "" ? "" : parseInt(val); 
    MES.State.persist(); 
    // تحديث ذكي: نحدث المؤشرات الحيوية وشريط التقدم فقط دون مسح هيكل الشاشة!
    MES.UI.updateGlobalKPIs(); 
    MES.UI.updateLiveProgressOnly(); 
    MES.UI.showToast("تم الحفظ"); 
},
    },

    Quality: {
        async addGroup(groupName) { if(!groupName || MES.State.defectSchema[groupName]) return; MES.State.defectSchema[groupName] = []; await MES.API.syncSchemaToCloud(); MES.UI.renderSchemaEditor(); MES.UI.showToast("تم إنشاء المجموعة"); },
        async addDefectToGroup(groupName) { const defectName = prompt(`عيب جديد لمجموعة [${groupName}]:`); if(!defectName || !defectName.trim() || MES.State.defectSchema[groupName].includes(defectName.trim())) return; MES.State.defectSchema[groupName].push(defectName.trim()); await MES.API.syncSchemaToCloud(); MES.UI.renderSchemaEditor(); },
        async deleteFromSchema(group, defect = null) { if(!defect) { if(confirm(`حذف مجموعة [${group}]؟`)) { delete MES.State.defectSchema[group]; await MES.API.syncSchemaToCloud(); } } else { MES.State.defectSchema[group] = MES.State.defectSchema[group].filter(d => d !== defect); await MES.API.syncSchemaToCloud(); } MES.UI.renderSchemaEditor(); },
        populateModalGroups() { const gs = document.getElementById('modalDefectGroup'); if(gs) { gs.innerHTML = Object.keys(MES.State.defectSchema).map(g => `<option value="${g}">${g}</option>`).join(''); this.updateModalDefects(); } },
        updateModalDefects() { const g = document.getElementById('modalDefectGroup').value; const item = document.getElementById('modalDefectCategory'); if(MES.State.defectSchema[g]) item.innerHTML = MES.State.defectSchema[g].map(i => `<option value="${i}">${i}</option>`).join(''); },
        openDefectModal(idx) { document.getElementById('modalIntervalIndex').value = idx; document.getElementById('modalDefectQty').value = 1; this.populateModalGroups(); document.getElementById('defectModal').classList.add('show'); },
        saveDefect() {
            const idx = document.getElementById('modalIntervalIndex').value; const cat = document.getElementById('modalDefectCategory').value;
            const qty = parseInt(document.getElementById('modalDefectQty').value) || 1; const disc = document.getElementById('modalDefectDiscoverer').value; 
            if(!cat) return; if(!MES.State.current.intervals[idx].defects) MES.State.current.intervals[idx].defects = [];
            MES.State.current.intervals[idx].defects.push({ category: cat, qty, discoverer: disc }); MES.State.persist(); document.getElementById('defectModal').classList.remove('show'); MES.UI.renderAll();
        },
        removeDefect(iIdx, dIdx) { if(confirm("حذف العيب؟")) { MES.State.current.intervals[iIdx].defects.splice(dIdx, 1); MES.State.persist(); MES.UI.renderAll(); } },
        calcYields() {
            let totalActual = 0, totalQualityDefects = 0, totalAllDefects = 0;
            MES.State.current.intervals.forEach(inv => { if (!inv.isBreak) { let aVal = Number(inv.actual) || 0; totalActual += aVal; if(inv.defects) { inv.defects.forEach(d => { totalAllDefects += d.qty; if(d.discoverer === 'quality') totalQualityDefects += d.qty; }); } } });
            let qYield = totalActual > 0 ? (Math.max(0, totalActual - totalQualityDefects) / totalActual * 100).toFixed(1) : 100; let oYield = totalActual > 0 ? (Math.max(0, totalActual - totalAllDefects) / totalActual * 100).toFixed(1) : 100;
            return { totalActual, qYield, oYield };
        }
    },

Scanner: {
        timeoutId: null,
        isProcessing: false,
        registeredItems: ['HF', '31'], // القائمة الدقيقة لمنع خطأ Unknown Model للعناصر الحقيقية
        
        handleInput(code) {
            if (this.isProcessing) return;
            this.isProcessing = true;
            
            // قاعدة حماية البيانات: الإجراء الافتراضي هو Do Not Register بعد 4 ثوانٍ
            this.timeoutId = setTimeout(() => {
                this.isProcessing = false;
                MES.UI.showToast("تجاوز الوقت المسموح - تم تفعيل Do Not Register", "error");
            }, 4000);

            this.processLogic(code);
        },
        processLogic(code) {
            setTimeout(() => {
                clearTimeout(this.timeoutId);
                if (!this.isProcessing) return; 
                this.isProcessing = false;
                
                let modelMatch = this.registeredItems.find(item => code.includes(item));
                if (modelMatch) {
                    MES.UI.showToast(`تم التعرف على: ${modelMatch}`, "success");
                } else {
                    MES.UI.showToast("Unknown Model - غير مدرج بالقائمة", "error");
                }
            }, 500);
        }
    },

    Reports: {
        openMenu() {
            document.getElementById('waReportModal').classList.add('show');
        },
        async send(reportType) {
            let text = '';
            const date = MES.State.current.date;
            const shift = MES.State.current.shift;

            switch(reportType) {
                case 'production':
                    // سيتم وضع تصميمك المخصص هنا لاحقاً
                    text = `[قالب رسالة الإنتاج اللحظية - في انتظار التصميم]`;
                    break;
                case 'daily':
                    const yields = MES.Quality.calcYields();
                    text = `*📊 المؤشرات اليومية - ${date}*\nالوردية: ${shift}\n━━━━━━━━━━\n✅ الفعلي: ${yields.totalActual}\n📈 الجودة: ${yields.qYield}%\n📉 الكلي: ${yields.oYield}%`;
                    break;
                case 'monthly':
                    text = `*📅 المؤشرات الشهرية التراكمية*\n[جاري تجميع بيانات الشهر الحالي...]`;
                    break;
                case 'prev_month':
                    text = `*⏳ مؤشرات الشهر السابق*\n[جاري استدعاء البيانات التاريخية...]`;
                    break;
                case 'foaming':
                    let foamDone = MES.State.monitor.foaming.filter(r=>r.status==='done').length;
                    text = `*🧴 تحليل بيانات الرش*\nإجمالي التذاكر: ${MES.State.monitor.foaming.length}\nتم الإصلاح: ${foamDone}`;
                    break;
                case 'cooling':
                    let coolTotal = MES.State.monitor.cooling.reduce((sum, r) => sum + r.qty, 0);
                    text = `*❄️ تحليل بيانات التبريد*\nإجمالي العيوب المسجلة اليوم: ${coolTotal}`;
                    break;
                case 'quality':
                    text = `*🛡️ تحليل عيوب الجودة*\n[جاري تصدير قائمة باريتو لأعلى العيوب...]`;
                    break;
            }

            if (text) {
                const encodedText = encodeURIComponent(text);
                window.open(`https://wa.me/?text=${encodedText}`, '_blank');
                closeModal('waReportModal');
                MES.UI.showToast("جاري التوجيه للواتساب...", "success");
            }
        }
    },

    Monitor: {
        async fetchFoamingData() {
            const date = document.getElementById('foamDateSelector').value || MES.State.current.date; if(!MES.API.client) return;
            const { data } = await MES.API.client.from('production_shifts').select('shift_data').eq('shift_id', `${date}_FOAMING`).maybeSingle();
            MES.State.monitor.foaming = (data && data.shift_data && data.shift_data.records) ? data.shift_data.records : []; MES.UI.renderFoamingTickets();
        },
        async fetchCoolingData() {
            const date = document.getElementById('coolingDateSelector').value || MES.State.current.date; const shift = document.getElementById('coolingShiftSelector').value || '1'; if(!MES.API.client) return;
            const { data } = await MES.API.client.from('production_shifts').select('shift_data').eq('shift_id', `${date}_COOLING_${shift}`).maybeSingle();
            MES.State.monitor.cooling = (data && data.shift_data && data.shift_data.records) ? data.shift_data.records : []; MES.UI.renderCoolingTable();
        },
        async fetchOleData() {
            const date = document.getElementById('oleDateSelector').value || MES.State.current.date; const shift = document.getElementById('oleShiftSelector').value || '1'; if(!MES.API.client) return;
            const { data } = await MES.API.client.from('production_shifts').select('shift_data').eq('shift_id', `${date}_OLE_${shift}`).maybeSingle();
            if(data && data.shift_data && data.shift_data.data) { const d = data.shift_data.data; ['olePlannedLabor', 'oleActualProdLabor', 'oleShiftTime', 'oleDowntime', 'oleTotalProd', 'oleDefects', 'oleCycleTime'].forEach(id => { const el = document.getElementById(id); if(el && d[id] !== undefined) el.value = d[id]; }); }
            this.calcOle();
        },
        async saveFoaming() {
            const name = document.getElementById('foamDefectName').value.trim(); if(!name) return;
            MES.State.monitor.foaming.push({ id: Date.now().toString(), timestamp: new Date().toLocaleTimeString('ar-EG', { hour12: true, hour: "numeric", minute: "numeric"}), name: name, desc: document.getElementById('foamDefectDesc').value.trim(), status: 'pending' });
            await MES.API.syncMonitorDoc('foaming', document.getElementById('foamDateSelector').value || MES.State.current.date, '1', MES.State.monitor.foaming); document.getElementById('foamingModal').classList.remove('show'); MES.UI.renderFoamingTickets(); MES.UI.showToast("تم الإصدار");
        },
        async updateFoamingStatus(id, status) { const rec = MES.State.monitor.foaming.find(r => r.id === id); if(rec) { rec.status = status; await MES.API.syncMonitorDoc('foaming', document.getElementById('foamDateSelector').value || MES.State.current.date, '1', MES.State.monitor.foaming); MES.UI.renderFoamingTickets(); } },
        async deleteFoaming(id) { if(confirm("حذف؟")) { MES.State.monitor.foaming = MES.State.monitor.foaming.filter(r => r.id !== id); await MES.API.syncMonitorDoc('foaming', document.getElementById('foamDateSelector').value || MES.State.current.date, '1', MES.State.monitor.foaming); MES.UI.renderFoamingTickets(); } },
        updateCoolingCascades() { const dept = document.getElementById('coolDept').value; const typeSel = document.getElementById('coolDefectType'); const pointSel = document.getElementById('coolDefectPoint'); typeSel.innerHTML = ''; MES.Config.coolingMaster.defectTypes[dept].forEach(t => typeSel.innerHTML += `<option value="${t}">${t}</option>`); pointSel.innerHTML = ''; MES.Config.coolingMaster.points.forEach(p => pointSel.innerHTML += `<option value="${p}">${p}</option>`); },
        autoFillStamp() { document.getElementById('coolResponsibleName').value = MES.Config.coolingMaster.stamps[document.getElementById('coolStamp').value.trim()] || 'غير مدرج'; },
        async saveCooling() { MES.State.monitor.cooling.push({ id: Date.now().toString(), dept: document.getElementById('coolDept').value, supervisor: document.getElementById('coolSupervisor').value, model: document.getElementById('coolModel').value, type: document.getElementById('coolDefectType').value, point: document.getElementById('coolDefectPoint').value, stamp: document.getElementById('coolStamp').value.trim(), name: document.getElementById('coolResponsibleName').value, qty: parseInt(document.getElementById('coolQty').value) || 1 }); await MES.API.syncMonitorDoc('cooling', document.getElementById('coolingDateSelector').value || MES.State.current.date, document.getElementById('coolingShiftSelector').value || '1', MES.State.monitor.cooling); document.getElementById('coolingModal').classList.remove('show'); MES.UI.renderCoolingTable(); MES.UI.showToast("تم الحفظ"); },
        async deleteCooling(id) { if(confirm("حذف؟")) { MES.State.monitor.cooling = MES.State.monitor.cooling.filter(r => r.id !== id); await MES.API.syncMonitorDoc('cooling', document.getElementById('coolingDateSelector').value || MES.State.current.date, document.getElementById('coolingShiftSelector').value || '1', MES.State.monitor.cooling); MES.UI.renderCoolingTable(); } },
        calcOle() {
            const pLabor = parseFloat(document.getElementById('olePlannedLabor').value) || 0; const aProdLabor = parseFloat(document.getElementById('oleActualProdLabor').value) || 0; const sTime = parseFloat(document.getElementById('oleShiftTime').value) || 0; const dTime = parseFloat(document.getElementById('oleDowntime').value) || 0; const totalProd = parseFloat(document.getElementById('oleTotalProd').value) || 0; const defects = parseFloat(document.getElementById('oleDefects').value) || 0; const cTime = parseFloat(document.getElementById('oleCycleTime').value) || 0;
            const netOpTime = Math.max(0, sTime - dTime); let A = sTime > 0 ? (netOpTime / sTime) : 0; let P = netOpTime > 0 ? (totalProd * cTime) / netOpTime : 0; P = Math.min(P, 1.0); let Q = totalProd > 0 ? Math.max(0, (totalProd - defects) / totalProd) : 0; let U = pLabor > 0 ? Math.min((aProdLabor / pLabor), 1.0) : 0; let ole = A * P * Q * U;
            document.getElementById('kpi-ole-availability').innerText = (A * 100).toFixed(1) + '%'; document.getElementById('kpi-ole-performance').innerText = (P * 100).toFixed(1) + '%'; document.getElementById('kpi-ole-quality').innerText = (Q * 100).toFixed(1) + '%'; document.getElementById('kpi-ole-total').innerText = (ole * 100).toFixed(1) + '%';
            MES.State.monitor.ole = { plannedLabor: pLabor, actualProdLabor: aProdLabor, shiftTime: sTime, downtime: dTime, downtimeReason: document.getElementById('oleDowntimeReason').value, totalProd, defects, cycleTime: cTime, ole };
        },
        async saveOle() { this.calcOle(); await MES.API.syncMonitorDoc('ole', document.getElementById('oleDateSelector').value || MES.State.current.date, document.getElementById('oleShiftSelector').value || '1', MES.State.monitor.ole); MES.UI.showToast("تم الحفظ"); }
    },

    // =========================================================================
    // 🧠 المحرك المعماري للتشريح التفاعلي (Interactive BI Matrix Engine)
    // =========================================================================
    Analytics: {
        charts: {},
        cachedData: [], // لتخزين الداتا مؤقتاً للتشريح

        async loadData() {
            if(!MES.API.client) return;
            MES.UI.showToast("جاري استخراج الرؤى الهندسية...", "success");
            const dFrom = document.getElementById('analyticsDateFrom').value; const dTo = document.getElementById('analyticsDateTo').value;
            try {
                const { data } = await MES.API.client.from('production_shifts').select('shift_id, shift_data');
                if(!data) return;
                this.cachedData = data.filter(row => {
                    if (row.shift_id.includes('CONFIG') || row.shift_id.includes('MASTER')) return false;
                    let datePart = row.shift_id.split('_')[0];
                    if (dFrom && datePart < dFrom) return false;
                    if (dTo && datePart > dTo) return false;
                    return true;
                });
                this.processAndRenderMacro(this.cachedData);
            } catch (e) { console.error("Analytics Error", e); }
        },

        processAndRenderMacro(data) {
            let totalUnits = 0, totalQualDefects = 0, totalAllDefects = 0, oleSum = 0, oleCount = 0;
            let daysMap = {}, topDefectsMap = {}, downtimeMap = {};

            data.forEach(row => {
                let dateKey = row.shift_id.split('_')[0];
                if(!daysMap[dateKey]) daysMap[dateKey] = { actual:0, qualDef:0, ole:0, shifts: {} };

                if (row.shift_id.includes('_Shift_') && row.shift_data.intervals) {
                    let shiftNum = row.shift_id.split('_Shift_')[1];
                    if(!daysMap[dateKey].shifts[shiftNum]) daysMap[dateKey].shifts[shiftNum] = { actual:0, qualDef:0 };
                    
                    row.shift_data.intervals.forEach(inv => {
                        if(!inv.isBreak) {
                            let act = Number(inv.actual) || 0;
                            daysMap[dateKey].actual += act; daysMap[dateKey].shifts[shiftNum].actual += act; totalUnits += act;
                            if(inv.defects) { inv.defects.forEach(d => {
                                totalAllDefects += d.qty;
                                if(d.discoverer === 'quality') { daysMap[dateKey].qualDef += d.qty; daysMap[dateKey].shifts[shiftNum].qualDef += d.qty; totalQualDefects += d.qty; }
                                topDefectsMap[d.category] = (topDefectsMap[d.category] || 0) + d.qty;
                            }); }
                        }
                    });
                } else if (row.shift_id.includes('_OLE_') && row.shift_data.data) {
                    let d = row.shift_data.data;
                    if(d.ole > 0) { oleSum += d.ole; oleCount++; }
                    if(d.downtime > 0 && d.downtimeReason) { let reason = d.downtimeReason.trim(); downtimeMap[reason] = (downtimeMap[reason] || 0) + d.downtime; }
                }
            });

            let avgYield = totalUnits > 0 ? (Math.max(0, totalUnits - totalQualDefects) / totalUnits * 100).toFixed(1) : 0;
            let avgOle = oleCount > 0 ? ((oleSum / oleCount) * 100).toFixed(1) : 0;

            const elProd = document.getElementById('bi-kpi-prod'); if(elProd) elProd.innerText = totalUnits;
            const elYield = document.getElementById('bi-kpi-yield'); if(elYield) elYield.innerText = avgYield + '%';
            const elDef = document.getElementById('bi-kpi-defects'); if(elDef) elDef.innerText = totalAllDefects;
            const elOle = document.getElementById('bi-kpi-ole'); if(elOle) elOle.innerText = avgOle + '%';

            let sortedDefects = Object.keys(topDefectsMap).sort((a,b) => topDefectsMap[b] - topDefectsMap[a]);
            let sortedDt = Object.keys(downtimeMap).sort((a,b) => downtimeMap[b] - downtimeMap[a]);
            
            const elInsightBot = document.getElementById('insight-bottleneck'); if(elInsightBot) elInsightBot.innerText = sortedDt.length > 0 ? `${sortedDt[0]} (${downtimeMap[sortedDt[0]]} دقيقة توقف)` : "مستقر";

            this.macroDaysMap = daysMap; // حفظ للاستخدام في التشريح
            this.macroDowntimeMap = downtimeMap;
            this.drawMacroCharts(daysMap, sortedDefects, topDefectsMap, avgOle);
        },

        drawMacroCharts(daysMap, sortedDefects, topDefectsMap, avgOle) {
            let isLight = document.documentElement.getAttribute('data-theme') === 'light'; Chart.defaults.color = isLight ? '#475569' : '#8e8e93'; Chart.defaults.font.family = 'Cairo'; let gridColor = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';

            // 1. Yield Chart (Macro)
            let labels = Object.keys(daysMap).sort();
            let yieldData = labels.map(l => { let d = daysMap[l]; return d.actual > 0 ? (Math.max(0, d.actual - d.qualDef)/d.actual * 100).toFixed(1) : 100; });
            if(this.charts.yield) this.charts.yield.destroy();
            const ctxYield = document.getElementById('yieldChart');
            if(ctxYield) {
                this.charts.yield = new Chart(ctxYield, {
                    type: 'line', data: { labels: labels, datasets: [ { label: 'Yield %', data: yieldData, borderColor: '#00e5ff', backgroundColor: 'rgba(0, 229, 255, 0.1)', fill: true, tension: 0.4, borderWidth: 3, pointRadius: 5, pointHoverRadius: 8 } ] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 80, max: 100, grid: { color: gridColor } }, x: { grid: { color: gridColor } } } }
                });
            }

            // 2. Pareto Chart (Macro)
            let paretoLabels = sortedDefects.slice(0, 5); let paretoData = paretoLabels.map(k => topDefectsMap[k]);
            if(this.charts.pareto) this.charts.pareto.destroy();
            const ctxPareto = document.getElementById('paretoChart');
            if(ctxPareto) {
                this.charts.pareto = new Chart(ctxPareto, {
                    type: 'bar', data: { labels: paretoLabels, datasets: [{ label: 'عدد العيوب', data: paretoData, backgroundColor: '#ff1744', borderRadius: 4 }] },
                    options: { 
                        responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: gridColor } }, x: { grid: { display: false } } },
                        onClick: (e, elements) => { if(elements.length > 0) MES.Analytics.drillDownDefect(paretoLabels[elements[0].index]); } 
                    }
                });
            }

            this.drawGauge('gaugeAvailability', 'التوافر', 85, '#00e5ff'); this.drawGauge('gaugePerformance', 'الأداء', 92, '#ffb300'); this.drawGauge('gaugeQuality', 'الجودة', parseFloat(avgOle) > 0 ? 98 : 0, '#00e676');
        },

        drawGauge(id, title, val, color) {
            let isLight = document.documentElement.getAttribute('data-theme') === 'light'; let emptyColor = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'; let textColor = isLight ? '#0f172a' : '#ffffff';
            if(this.charts[id]) this.charts[id].destroy(); const ctx = document.getElementById(id); if(!ctx) return;
            this.charts[id] = new Chart(ctx, { type: 'doughnut', data: { datasets: [{ data: [val, 100-val], backgroundColor: [color, emptyColor], borderWidth: 0, circumference: 250, rotation: -125 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '80%', plugins: { tooltip: { enabled: false }, title: { display: true, text: title, position: 'bottom', color: textColor, font: { family: 'Cairo' } } } }, plugins: [{ id: 'textCenter', beforeDraw: function(chart) { let width = chart.width, height = chart.height, c = chart.ctx; c.restore(); let fontSize = (height / 114).toFixed(2); c.font = "900 " + fontSize + "em Orbitron"; c.textBaseline = "middle"; c.fillStyle = color; let text = val + "%", textX = Math.round((width - c.measureText(text).width) / 2), textY = height / 1.7; c.fillText(text, textX, textY); c.save(); } }] });
        },

        // --------------------------------------------------------
        // 🔬 طبقات التشريح المتقدمة (Interactive Drill-Downs)
        // --------------------------------------------------------

        // Triggered when clicking on the Yield Line Chart
        triggerYieldDrillDown(event) {
            const points = this.charts.yield.getElementsAtEventForMode(event, 'nearest', { intersect: true }, true);
            if (points.length) {
                const dayLabel = this.charts.yield.data.labels[points[0].index];
                this.drillDownDay(dayLabel);
            }
        },

        // Level 2: Day Drill-Down (Shows Shifts)
        drillDownDay(dateKey) {
            document.getElementById('dd-day-title').innerText = dateKey;
            const dayData = this.macroDaysMap[dateKey];
            if(!dayData) return;

            let dYield = dayData.actual > 0 ? (Math.max(0, dayData.actual - dayData.qualDef)/dayData.actual * 100).toFixed(1) : 100;
            document.getElementById('dd-day-prod').innerText = dayData.actual;
            document.getElementById('dd-day-yield').innerText = dYield + '%';

            let shifts = ['1', '2', '3'];
            let shiftYields = shifts.map(s => {
                let sd = dayData.shifts[s];
                if(!sd || sd.actual === 0) return 0;
                return (Math.max(0, sd.actual - sd.qualDef)/sd.actual * 100).toFixed(1);
            });

            if(this.charts.ddDay) this.charts.ddDay.destroy();
            this.charts.ddDay = new Chart(document.getElementById('dd-day-chart'), {
                type: 'bar',
                data: { labels: ['الوردية الأولى', 'الوردية الثانية', 'الوردية الثالثة'], datasets: [{ label: 'Yield %', data: shiftYields, backgroundColor: ['#00e5ff', '#ffb300', '#bf5af2'], borderRadius: 6 }] },
                options: { 
                    responsive: true, maintainAspectRatio: false, scales: { y: { min: 50, max: 100 } },
                    onClick: (e, elements) => { if(elements.length > 0) MES.Analytics.drillDownShift(dateKey, shifts[elements[0].index]); }
                }
            });
            document.getElementById('ddDayModal').classList.add('show');
        },

        // Triggered when clicking on a Shift Bar inside Day Drill-Down
        triggerShiftDrillDown(event) {
            const points = this.charts.ddDay.getElementsAtEventForMode(event, 'nearest', { intersect: true }, true);
            if (points.length) {
                const shiftIndex = points[0].index + 1; // 1, 2, or 3
                const dateKey = document.getElementById('dd-day-title').innerText;
                this.drillDownShift(dateKey, shiftIndex.toString());
            }
        },

        // Level 3: Shift Drill-Down (Shows Hourly Production Line)
        drillDownShift(dateKey, shiftNum) {
            document.getElementById('dd-shift-title').innerText = `${dateKey} | الوردية ${shiftNum}`;
            const targetShiftId = `${dateKey}_Shift_${shiftNum}`;
            const shiftRecord = this.cachedData.find(r => r.shift_id === targetShiftId);
            
            let hourlyLabels = []; let hourlyActual = []; let hourlyTarget = [];
            if(shiftRecord && shiftRecord.shift_data.intervals) {
                shiftRecord.shift_data.intervals.forEach(inv => {
                    if(!inv.isBreak) {
                        hourlyLabels.push(MES.Production.formatAMPM(inv.start).replace(/<[^>]*>?/gm, ''));
                        hourlyActual.push(Number(inv.actual) || 0);
                        hourlyTarget.push(inv.target || 0);
                    }
                });
            }

            if(this.charts.ddShift) this.charts.ddShift.destroy();
            this.charts.ddShift = new Chart(document.getElementById('dd-shift-hourly-chart'), {
                type: 'line',
                data: { labels: hourlyLabels, datasets: [
                    { label: 'الفعلي', data: hourlyActual, borderColor: '#00e676', backgroundColor: 'rgba(0,230,118,0.1)', fill:true, tension:0.3, borderWidth:3 },
                    { label: 'الهدف', data: hourlyTarget, borderColor: '#8e8e93', borderDash: [5, 5], tension:0.3, borderWidth:2 }
                ]},
                options: { responsive: true, maintainAspectRatio: false }
            });
            document.getElementById('ddShiftModal').classList.add('show');
        },

        // OLE Downtime Drill-Down
        drillDownOLE() {
            let dtReasons = Object.keys(this.macroDowntimeMap).sort((a,b) => this.macroDowntimeMap[b] - this.macroDowntimeMap[a]).slice(0, 10);
            let dtVals = dtReasons.map(k => this.macroDowntimeMap[k]);

            if(this.charts.ddOle) this.charts.ddOle.destroy();
            this.charts.ddOle = new Chart(document.getElementById('dd-dt-chart'), {
                type: 'bar',
                data: { labels: dtReasons, datasets: [{ label: 'دقائق التوقف', data: dtVals, backgroundColor: '#ffb300', borderRadius: 4 }] },
                options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y' }
            });
            document.getElementById('ddOleModal').classList.add('show');
        },

        // Master Defect Deep Dive
        drillDownDefect(defectName) {
            let dailyTrend = {}; let shiftStats = { "1": 0, "2": 0, "3": 0 }; let modelStats = {}; let totalCount = 0; let totalProd = 0;
            this.cachedData.forEach(row => {
                if (!row.shift_data || !row.shift_data.intervals) return;
                let dateKey = row.shift_id.split('_')[0]; let shiftNum = row.shift_id.includes('_Shift_') ? row.shift_id.split('_Shift_')[1] : "1";
                row.shift_data.intervals.forEach(inv => {
                    if(inv.isBreak) return; totalProd += (Number(inv.actual) || 0);
                    if(inv.defects) { inv.defects.forEach(d => { if(d.category === defectName) { let q = d.qty || 1; totalCount += q; dailyTrend[dateKey] = (dailyTrend[dateKey] || 0) + q; shiftStats[shiftNum] += q; if(d.model) modelStats[d.model] = (modelStats[d.model] || 0) + q; } }); }
                });
            });

            document.getElementById('master-dd-name').innerText = defectName; document.getElementById('master-dd-total').innerText = totalCount;
            document.getElementById('master-dd-impact').innerText = totalProd > 0 ? ((totalCount / totalProd) * 100).toFixed(2) + '%' : '0%';
            let topShift = Object.keys(shiftStats).sort((a,b) => shiftStats[b] - shiftStats[a])[0]; document.getElementById('master-dd-shift').innerText = `الوردية ${topShift}`;

            let sortedDates = Object.keys(dailyTrend).sort();
            if(this.charts.masterTrend) this.charts.masterTrend.destroy(); this.charts.masterTrend = new Chart(document.getElementById('master-dd-trend-chart'), { type: 'line', data: { labels: sortedDates, datasets: [{ label: 'التكرار', data: sortedDates.map(d => dailyTrend[d]), borderColor: '#ff1744', backgroundColor: 'rgba(255, 23, 68, 0.1)', fill: true, tension: 0.4, borderWidth: 3 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
            if(this.charts.masterShift) this.charts.masterShift.destroy(); this.charts.masterShift = new Chart(document.getElementById('master-dd-shift-chart'), { type: 'bar', data: { labels: ['الوردية 1', 'الوردية 2', 'الوردية 3'], datasets: [{ data: [shiftStats["1"], shiftStats["2"], shiftStats["3"]], backgroundColor: ['#00e5ff', '#ffb300', '#bf5af2'], borderRadius: 5 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
            let modelLabels = Object.keys(modelStats); if(this.charts.masterModel) this.charts.masterModel.destroy(); this.charts.masterModel = new Chart(document.getElementById('master-dd-model-chart'), { type: 'doughnut', data: { labels: modelLabels.length ? modelLabels : ['عام'], datasets: [{ data: modelLabels.length ? Object.values(modelStats) : [totalCount], backgroundColor: ['#00e676', '#ff1744', '#00e5ff', '#ffb300'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } } });
            
            document.getElementById('masterDeepDiveModal').classList.add('show');
        }
    },

   UI: {
    vibrate(type = 'success') {
        if (!navigator.vibrate) return;
        // اهتزاز خفيف للنجاح، واهتزاز تحذيري قوي للأخطاء أو الحذف
        if (type === 'success') navigator.vibrate([100]); 
        if (type === 'error' || type === 'delete') navigator.vibrate([50, 50, 200]); 
    },
    showToast(message, type = 'success') { 
        this.vibrate(type); // تفعيل الاهتزاز مع كل إشعار
        const toast = document.getElementById('toast'); 
        if (!toast) return; 
        toast.innerText = message; 
        toast.style.backgroundColor = type === 'error' ? 'var(--accent-red)' : '#16a34a'; 
        toast.classList.add('show'); 
        setTimeout(() => toast.classList.remove('show'), 3000); 
    },


        renderAll() { this.renderProductionGrid(); this.renderDefectsTable(); this.updateGlobalKPIs(); },
        updateGlobalKPIs() { const yields = MES.Quality.calcYields(); const qYieldEl = document.getElementById('kpi-quality-yield'); const oYieldEl = document.getElementById('kpi-overall-yield'); if(qYieldEl) qYieldEl.innerText = yields.qYield + '%'; if(oYieldEl) oYieldEl.innerText = yields.oYield + '%'; const homeYieldEl = document.getElementById('main-kpi-dyield'); const homeProdEl = document.getElementById('main-kpi-dprod'); if(homeYieldEl) homeYieldEl.innerText = yields.qYield + '%'; if(homeProdEl) homeProdEl.innerText = yields.totalActual; },
     
updateLiveProgressOnly() {
        let shiftTargetTotal = 0, shiftActualTotal = 0;
        MES.State.current.intervals.forEach(inv => {
            if (!inv.isBreak && inv.actual !== "") {
                shiftTargetTotal += inv.target;
                shiftActualTotal += Number(inv.actual);
            }
        });

        const actualBox = document.getElementById('kpi-prod-shift-actual');
        const varianceBox = document.getElementById('kpi-prod-shift-variance');
        const progressText = document.getElementById('shift-progress-text');
        const progressBar = document.getElementById('shift-progress-bar');

        if (actualBox) actualBox.innerText = shiftActualTotal;
        if (varianceBox) {
            let shiftVar = shiftActualTotal - shiftTargetTotal;
            varianceBox.innerText = (shiftVar > 0 ? '+' : '') + shiftVar;
            varianceBox.style.color = (shiftVar >= 0 ? 'var(--accent-green)' : 'var(--accent-red)');
        }

        let fullTarget = MES.State.current.target;
        let progressPerc = fullTarget > 0 ? Math.min((shiftActualTotal / fullTarget) * 100, 100).toFixed(1) : 0;

        if (progressBar) progressBar.style.width = progressPerc + '%';
        if (progressText) progressText.innerText = progressPerc + '%';
    },
   renderProductionGrid() { const container = document.getElementById('productionCardsContainer'); if (!container) return; const intervals = MES.State.current.intervals; const fragment = document.createDocumentFragment(); let shiftTargetTotal = 0, shiftActualTotal = 0; intervals.forEach((inv, index) => { const rowDiv = document.createElement('div'); rowDiv.className = 'prod-list-item'; if (inv.isBreak) { rowDiv.style.borderColor = 'rgba(255, 179, 0, 0.3)'; rowDiv.style.background = 'rgba(255, 179, 0, 0.05)'; rowDiv.style.textAlign = 'center'; rowDiv.innerHTML = `<span style="color:var(--accent-orange); font-weight:800; font-size: 1rem;"><i class="fa-solid fa-mug-hot"></i> وقت راحة (${MES.Production.formatAMPM(inv.start)} - ${MES.Production.formatAMPM(inv.end)})</span>`; } else { let actualVal = inv.actual !== "" ? Number(inv.actual) : 0; if (inv.actual !== "") { shiftTargetTotal += inv.target; shiftActualTotal += actualVal; } let defectsHTML = ''; if(inv.defects && inv.defects.length > 0) { defectsHTML = `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border-subtle);">`; inv.defects.forEach((d, dIdx) => { let badgeClass = d.discoverer === 'quality' ? 'quality' : 'production'; defectsHTML += `<span class="defect-badge ${badgeClass}" onclick="MES.Quality.removeDefect(${index}, ${dIdx})">${d.category} <strong>(${d.qty})</strong> <i class="fa-solid fa-xmark"></i></span>`; }); defectsHTML += `</div>`; } rowDiv.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 12px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px;"><span class="prod-time"><i class="fa-regular fa-clock" style="font-size:0.8rem; margin-left: 5px; color:var(--text-secondary);"></i> ${MES.Production.formatAMPM(inv.start)} - ${MES.Production.formatAMPM(inv.end)}</span><div style="text-align:left;"><div class="p-stat">الهدف: <span style="font-size: 1.1rem;">${inv.target}</span></div></div></div><div class="prod-action" style="display:flex; gap:10px;"><input type="number" id="act-input-${index}" value="${inv.actual !== '' ? inv.actual : ''}" min="0" placeholder="0" pattern="\\d*" style="flex:1;"><button class="btn btn-primary" style="width: auto; padding: 10px 20px; border-radius: 10px;" onclick="appState.saveActualRow(${index})"><i class="fa-solid fa-check"></i></button><button class="btn btn-danger" style="width: auto; padding: 10px 20px; border-radius: 10px;" onclick="MES.Quality.openDefectModal(${index})"><i class="fa-solid fa-triangle-exclamation"></i></button></div>${defectsHTML}`; } fragment.appendChild(rowDiv); }); container.innerHTML = ''; container.appendChild(fragment); const actualBox = document.getElementById('kpi-prod-shift-actual'); const varianceBox = document.getElementById('kpi-prod-shift-variance'); const progressText = document.getElementById('shift-progress-text'); const progressBar = document.getElementById('shift-progress-bar'); if (actualBox) actualBox.innerText = shiftActualTotal; if (varianceBox) { let shiftVar = shiftActualTotal - shiftTargetTotal; varianceBox.innerText = (shiftVar > 0 ? '+' : '') + shiftVar; varianceBox.style.color = (shiftVar >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'); } let fullTarget = MES.State.current.target; let progressPerc = fullTarget > 0 ? Math.min((shiftActualTotal / fullTarget) * 100, 100).toFixed(1) : 0; if (progressBar) progressBar.style.width = progressPerc + '%'; if (progressText) progressText.innerText = progressPerc + '%'; },
        renderDefectsTable() { const tbody = document.getElementById('defectsTableBody'); if(!tbody) return; const intervals = MES.State.current.intervals; if(intervals.length === 0) { tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px;">قم بإعداد الإنتاج أولاً</td></tr>`; return; } const fragment = document.createDocumentFragment(); intervals.forEach((inv, index) => { const tr = document.createElement('tr'); if (inv.isBreak) { tr.className = 'row-break'; tr.innerHTML = `<td colspan="4"><i class="fa-solid fa-mug-hot"></i> راحة</td>`; } else { let defectHTML = ''; if(inv.defects) { inv.defects.forEach((d, dIdx) => { let badgeClass = d.discoverer === 'quality' ? 'quality' : 'production'; defectHTML += `<span class="defect-badge ${badgeClass}" style="display:inline-block; margin-bottom:4px;"><span>${d.category} <strong style="font-family:'Orbitron';">(${d.qty})</strong></span><i class="fa-solid fa-circle-xmark" style="margin-right: 5px; cursor:pointer;" onclick="MES.Quality.removeDefect(${index}, ${dIdx})"></i></span><br>`; }); } tr.innerHTML = `<td style="font-family:'Orbitron'; font-size:0.8rem; color: var(--text-secondary);">${MES.Production.formatAMPM(inv.start)}<br>${MES.Production.formatAMPM(inv.end)}</td><td class="eng-num" style="color:var(--text-primary); font-size: 1.1rem;">${inv.actual !== "" ? inv.actual : 0}</td><td style="white-space:normal; min-width: 120px;">${defectHTML}</td><td style="text-align:center;"><button class="btn btn-danger" style="padding: 8px 12px; width:auto; border-radius:8px; margin: auto;" onclick="MES.Quality.openDefectModal(${index})"><i class="fa-solid fa-plus"></i></button></td>`; } fragment.appendChild(tr); }); tbody.innerHTML = ''; tbody.appendChild(fragment); },
        renderSchemaEditor() { const container = document.getElementById('defectGroupsContainer'); if(!container) return; container.innerHTML = ''; Object.keys(MES.State.defectSchema).forEach(groupName => { const div = document.createElement('div'); div.className = 'glass-card'; div.style.borderRight = '4px solid var(--accent-cyan)'; let itemsHTML = MES.State.defectSchema[groupName].map(item => `<div class="defect-badge" style="margin:5px; padding:8px 12px; font-size:0.9rem; border:1px solid var(--border-subtle); background:var(--surface-1);">${item} <i class="fa-solid fa-trash-can" style="margin-right:8px; cursor:pointer; color:var(--accent-red);" onclick="MES.Quality.deleteFromSchema('${groupName}', '${item}')"></i></div>`).join(''); div.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid var(--border-subtle); padding-bottom:10px;"><strong style="color:var(--accent-cyan); font-size:1.1rem;">${groupName}</strong><div style="display:flex; gap:10px;"><button class="btn btn-secondary" style="width:auto; padding:5px 10px; font-size:0.8rem;" onclick="MES.Quality.addDefectToGroup('${groupName}')"><i class="fa-solid fa-plus"></i> إضافة عيب</button><button class="btn btn-danger" style="width:auto; padding:5px 10px; font-size:0.8rem;" onclick="MES.Quality.deleteFromSchema('${groupName}')"><i class="fa-solid fa-xmark"></i> حذف المجموعة</button></div></div><div style="display:flex; flex-wrap:wrap;">${itemsHTML || '<span style="color:var(--text-secondary); font-size:0.8rem;">المجموعة فارغة..</span>'}</div>`; container.appendChild(div); }); },
        renderFoamingTickets() { const container = document.getElementById('foamingCardsContainer'); if(!container) return; container.innerHTML = ''; if(MES.State.monitor.foaming.length === 0) { container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-secondary);">لا توجد تذاكر معلقة.</div>`; } [...MES.State.monitor.foaming].reverse().forEach(rec => { let imgHTML = rec.image ? `<img src="${rec.image}" class="image-preview" onclick="openImageViewer('${rec.image}')">` : ``; let statusColor = rec.status === 'pending' ? 'var(--accent-orange)' : 'var(--accent-green)'; let selHtml = `<select style="width:100%; padding:8px; background:var(--surface-1); border-color: ${statusColor}; color: ${statusColor}; border-radius: 6px; font-weight: bold; text-align:center;" onchange="MES.Monitor.updateFoamingStatus('${rec.id}', this.value)"><option value="pending" ${rec.status === 'pending' ? 'selected' : ''}>⏳ تحت الإصلاح</option><option value="done" ${rec.status === 'done' ? 'selected' : ''}>✅ تم التسليم</option></select>`; const div = document.createElement('div'); div.className = 'glass-card'; div.style.marginBottom = '0'; div.style.padding = '12px'; div.style.borderLeft = `4px solid ${statusColor}`; div.innerHTML = `<div style="display:flex; justify-content:space-between; margin-bottom:8px;"><strong style="color:var(--text-primary); font-size:1rem;">${rec.name}</strong><span style="font-family:'Orbitron'; font-size:0.75rem; color:var(--text-secondary);">الآن</span></div><div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:10px;">${rec.desc || 'لا توجد ملاحظات إضافية'}</div><div style="display:flex; gap:10px; align-items:center;">${imgHTML} <div style="flex-grow:1; display:flex; flex-direction:column; gap:8px;">${selHtml}<button class="btn btn-secondary" style="padding:8px; font-size: 0.8rem; color: var(--accent-red);" onclick="MES.Monitor.deleteFoaming('${rec.id}')"><i class="fa-solid fa-trash-can"></i> حذف نهائي</button></div></div>`; container.appendChild(div); }); const ft = document.getElementById('kpi-foam-day-total'); const fd = document.getElementById('kpi-foam-day-done'); if(ft) ft.innerText = MES.State.monitor.foaming.length; if(fd) fd.innerText = MES.State.monitor.foaming.filter(r=>r.status==='done').length; },
        renderCoolingTable() { const tbody = document.getElementById('coolingTableBody'); if(!tbody) return; tbody.innerHTML = ''; let totalShift = 0; if(MES.State.monitor.cooling.length === 0) { tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 15px;">السجل نظيف.</td></tr>`; } [...MES.State.monitor.cooling].reverse().forEach(rec => { const tr = document.createElement('tr'); let isFinal = rec.dept === 'تجميع نهائي'; tr.innerHTML = `<td><span style="color:${isFinal ? 'var(--accent-cyan)' : 'var(--accent-orange)'}; font-weight:800; font-size:0.85rem;">${rec.dept}</span><br><span style="font-size:0.75rem; color:var(--text-secondary);">${rec.model}</span></td><td><strong style="color:var(--accent-red); font-size:0.85rem;">${rec.type}</strong><br><span style="font-size:0.75rem; color:var(--text-secondary);">${rec.point}</span></td><td class="eng-num">${rec.qty}</td><td style="text-align:center;"><i class="fa-solid fa-trash-can" style="color:var(--accent-red); cursor:pointer; padding:8px; background:rgba(255,23,68,0.1); border-radius:6px;" onclick="MES.Monitor.deleteCooling('${rec.id}')"></i></td>`; tbody.appendChild(tr); totalShift += rec.qty; }); const kt = document.getElementById('kpi-cooling-shift-total'); if(kt) kt.innerText = totalShift; }
    },

    Core: {
        async boot() {
            MES.API.init(); MES.State.init(); MES.State.load();
            await MES.API.loadSchemaFromCloud(); MES.UI.renderSchemaEditor(); 
            if (MES.State.current.intervals.length > 0) MES.UI.renderAll();
            await MES.Monitor.fetchFoamingData(); await MES.Monitor.fetchCoolingData();
            setTimeout(() => { const splash = document.getElementById('splash'); if (splash) splash.remove(); }, 800);
        }
    }
};

// =======================================================
// التوجيه العام وأزرار التطبيق
// =======================================================
const viewTitles = { 'home':'الرئيسية', 'prod':'متابعة الإنتاج', 'defect':'مؤشرات الجودة', 'bi':'التحليلات', 'monitor':'متابعة العيوب' };
window.switchNav = function(viewId) { document.querySelectorAll('.nav-item').forEach(el => { el.classList.remove('active'); if(el.getAttribute('onclick') && el.getAttribute('onclick').includes(`switchNav('${viewId}')`)) { el.classList.add('active'); } }); document.querySelectorAll('.view-layer').forEach(el => el.classList.add('hidden')); const targetView = document.getElementById('view-' + viewId); if(targetView) targetView.classList.remove('hidden'); const titleEl = document.getElementById('current-view-title'); if(titleEl) titleEl.innerText = viewTitles[viewId] || 'Production App'; window.scrollTo({ top: 0, behavior: 'smooth' }); };
window.switchProdSeg = function(seg) { document.querySelectorAll('#view-prod .seg-btn').forEach(el => el.classList.remove('active')); document.getElementById('seg-prod-'+seg).classList.add('active'); ['live', 'setup'].forEach(s => document.getElementById('prod-sec-'+s).classList.add('hidden')); document.getElementById('prod-sec-'+seg).classList.remove('hidden'); };
window.switchDefSeg = function(seg) { document.querySelectorAll('#view-defect .seg-btn').forEach(el => el.classList.remove('active')); document.getElementById('seg-def-'+seg).classList.add('active'); ['log', 'setup'].forEach(s => document.getElementById('def-sec-'+s).classList.add('hidden')); document.getElementById('def-sec-'+seg).classList.remove('hidden'); };
window.switchMonitorTab = function(tab) { document.querySelectorAll('#view-monitor .seg-btn').forEach(el => el.classList.remove('active')); document.getElementById('seg-mon-'+tab).classList.add('active'); ['spray', 'cooling', 'ole', 'cooling-analysis'].forEach(t => { const el = document.getElementById('mon-tab-'+t); if(el) el.classList.add('hidden'); }); document.getElementById('mon-tab-'+tab).classList.remove('hidden'); };

window.appState = { updateTarget: () => MES.Production.updateTarget(parseInt(document.getElementById('quickTarget').value) || 0), saveActualRow: (index) => MES.Production.saveActual(index, document.getElementById(`act-input-${index}`).value), saveDefect: () => MES.Quality.saveDefect(), loadProduction: () => MES.UI.renderProductionGrid(), loadDefects: () => MES.UI.renderDefectsTable() };
window.closeModal = (id) => { const el = document.getElementById(id); if(el) el.classList.remove('show'); };
window.openModal = (id) => { const el = document.getElementById(id); if(el) el.classList.add('show'); };
window.openImageViewer = (src) => { document.getElementById('viewerImage').src = src; window.openModal('imageViewModal'); };
window.updateDefectSubList = () => MES.Quality.updateModalDefects();
window.addNewDefectGroup = () => MES.Quality.addGroup(document.getElementById('newGroupName').value.trim());

window.openFoamingModal = () => { document.getElementById('foamDefectName').value=''; document.getElementById('foamDefectDesc').value=''; document.getElementById('foamDefectImage').value=''; window.openModal('foamingModal'); };
window.saveFoamingDefect = () => MES.Monitor.saveFoaming();
window.loadFoamingData = () => MES.Monitor.fetchFoamingData();

window.openCoolingModal = () => { document.getElementById('coolQty').value = 1; document.getElementById('coolStamp').value = ''; document.getElementById('coolResponsibleName').value = ''; MES.Monitor.updateCoolingCascades(); window.openModal('coolingModal'); };
window.updateCoolingCascades = () => MES.Monitor.updateCoolingCascades();
window.autoFillStampName = () => MES.Monitor.autoFillStamp();
window.saveCoolingDefect = () => MES.Monitor.saveCooling();
window.loadCoolingData = () => MES.Monitor.fetchCoolingData();
window.calculateOle = () => MES.Monitor.calcOle();
window.saveOleRecord = () => MES.Monitor.saveOle();
window.loadOleData = () => MES.Monitor.fetchOleData();

// وظائف التحليلات المتقدمة والتصدير
window.loadAnalyticsData = () => MES.Analytics.loadData();
window.switchBiChart = function(chartType) { document.querySelectorAll('#view-bi .seg-btn').forEach(el => el.classList.remove('active')); if(event && event.currentTarget) event.currentTarget.classList.add('active'); document.querySelectorAll('.chart-container').forEach(el => el.classList.add('hidden')); const target = document.getElementById('chart-'+chartType+'-container'); if(target) target.classList.remove('hidden'); };
window.exportAnalyticsToCSV = function() {
    if(MES.Analytics.cachedData.length === 0) { MES.UI.showToast("لا توجد بيانات للتصدير", "error"); return; }
    let csvContent = "التاريخ,الوردية,الإنتاج الفعلي,العيوب\n";
    MES.Analytics.cachedData.forEach(row => {
        if(row.shift_id.includes('_Shift_')) {
            let actual = 0, defects = 0;
            if(row.shift_data.intervals) row.shift_data.intervals.forEach(i => { if(!i.isBreak) { actual += (Number(i.actual)||0); if(i.defects) i.defects.forEach(d => defects += d.qty); } });
            csvContent += `${row.shift_id.split('_')[0]},${row.shift_id.split('_Shift_')[1]},${actual},${defects}\n`;
        }
    });
    const blob = new Blob(["\uFEFF"+csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", `تقرير_انتاج_${new Date().toISOString().split('T')[0]}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
};
window.toggleTheme = () => { const htmlEl = document.documentElement; const current = htmlEl.getAttribute('data-theme') || 'dark'; htmlEl.setAttribute('data-theme', current === 'light' ? 'dark' : 'light'); localStorage.setItem('mes_theme', current === 'light' ? 'dark' : 'light'); };
window.shareToWhatsApp = () => { MES.Reports.openMenu(); };
window.addEventListener('DOMContentLoaded', () => { MES.Core.boot(); });