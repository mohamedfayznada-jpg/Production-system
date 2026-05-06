// التصحيح: النطاق الأساسي فقط بدون أي إضافات
const supabaseUrl = 'https://xaqqbxtxkzximwsnwezw.supabase.co'; 
const supabaseKey = 'sb_publishable_F-NNQh4BT3lpEgHIszFCvg_ZJvCmERP';[cite: 2]
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);[cite: 2]
// 2. State Management
let globalIntervals = [];
let currentDocId = "";

class ShiftLogic {
    static timeToMins(timeStr) {
        let [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    }
    static formatTime(mins) {
        mins = mins % (24 * 60);
        let h = Math.floor(mins / 60).toString().padStart(2, '0');
        let m = (mins % 60).toString().padStart(2, '0');
        return `${h}:${m}`;
    }
}

// 3. Main Initialization & Supabase Load
async function initializeShift() {
    const shiftType = document.getElementById('shiftType').value;
    const today = new Date().toISOString().split('T')[0];
    currentDocId = `${today}_Shift_${shiftType}`;

    // Fetch existing shift data from Supabase
    const { data, error } = await supabaseClient
        .from('production_shifts')
        .select('shift_data')
        .eq('shift_id', currentDocId)
        .maybeSingle();

    if (data && data.shift_data) {
        console.log("[SYS_LOAD] Existing shift data loaded from Supabase.");
        globalIntervals = data.shift_data.intervals;
        document.getElementById('totalTarget').value = data.shift_data.totalTarget;
        renderDashboard();
        return; 
    } else if (error && error.code !== 'PGRST116') { // PGRST116 means zero rows (normal for new shift)
        console.error("[SYS_ERROR] Database read error:", error);
    }

    generateNewShift();
}

function generateNewShift() {
    const sStart = ShiftLogic.timeToMins(document.getElementById('sStart').value);
    let sEnd = ShiftLogic.timeToMins(document.getElementById('sEnd').value);
    const bStart = ShiftLogic.timeToMins(document.getElementById('bStart').value);
    let bEnd = ShiftLogic.timeToMins(document.getElementById('bEnd').value);
    const totalTarget = parseInt(document.getElementById('totalTarget').value);

    if (sEnd < sStart) sEnd += 24 * 60;
    if (bEnd < bStart) bEnd += 24 * 60;

    const netProductionMins = (sEnd - sStart) - (bEnd - bStart);
    if (netProductionMins <= 0 || !totalTarget) return;

    const unitsPerMin = totalTarget / netProductionMins;
    globalIntervals = [];
    let current = sStart;
    let accumulatedTarget = 0;

    while (current < sEnd) {
        if (current === bStart) {
            globalIntervals.push({ isBreak: true, start: bStart, end: bEnd, duration: bEnd - bStart });
            current = bEnd;
            continue;
        }

        let intervalEnd = current + 60;
        if (current < bStart && intervalEnd > bStart) intervalEnd = bStart;
        if (intervalEnd > sEnd) intervalEnd = sEnd;

        let duration = intervalEnd - current;
        let roundedTarget = Math.round(unitsPerMin * duration);
        
        globalIntervals.push({ isBreak: false, start: current, end: intervalEnd, duration: duration, target: roundedTarget, actual: 0 });
        accumulatedTarget += roundedTarget;
        current = intervalEnd;
    }

    let diff = totalTarget - accumulatedTarget;
    for (let i = globalIntervals.length - 1; i >= 0; i--) {
        if (!globalIntervals[i].isBreak) { globalIntervals[i].target += diff; break; }
    }

    syncToSupabase();
    renderDashboard();
}

// 4. Supabase Synchronization (Upsert Logic)
async function syncToSupabase() {
    if (!currentDocId) return;
    
    const payload = {
        shift_id: currentDocId,
        shift_data: {
            intervals: globalIntervals,
            shiftType: document.getElementById('shiftType').value,
            totalTarget: document.getElementById('totalTarget').value
        },
        updated_at: new Date().toISOString()
    };

    // Upsert: Updates existing row or inserts a new one automatically based on Primary Key
    const { error } = await supabaseClient
        .from('production_shifts')
        .upsert(payload);

    if (error) {
        console.error("[SYS_SYNC_ERROR] Failed to push data:", error);
    } else {
        console.log(`[SYS_SYNC] Data pushed successfully for: ${currentDocId}`);
    }
}

// 5. UI Render & Events
function renderDashboard() {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';
    
    globalIntervals.forEach((inv, index) => {
        const tr = document.createElement('tr');
        let startFmt = ShiftLogic.formatTime(inv.start);
        let endFmt = ShiftLogic.formatTime(inv.end);

        if (inv.isBreak) {
            tr.className = 'row-break';
            tr.innerHTML = `<td>${startFmt} - ${endFmt}</td><td colspan="3">وقت راحة</td>`;
        } else {
            tr.innerHTML = `
                <td>${startFmt} - ${endFmt}</td>
                <td class="cell-target">${inv.target}</td>
                <td><input type="number" class="prod-input" value="${inv.actual}" min="0" onchange="updateActual(${index}, this.value)"></td>
                <td id="var_${index}" style="font-weight: bold;">0</td>
            `;
        }
        tbody.appendChild(tr);
        if(!inv.isBreak) updateVarianceUI(index);
    });

    document.getElementById('prodPanel').style.display = 'block';
    updateOverallStatus();
}

function updateActual(index, value) {
    globalIntervals[index].actual = parseInt(value) || 0;
    updateVarianceUI(index);
    updateOverallStatus();
    syncToSupabase(); 
}

function updateVarianceUI(index) {
    let variance = globalIntervals[index].actual - globalIntervals[index].target;
    let cell = document.getElementById(`var_${index}`);
    cell.innerText = (variance > 0 ? '+' : '') + variance;
    cell.style.color = variance < 0 ? 'var(--danger-red)' : (variance > 0 ? 'var(--success-green)' : 'var(--text-main)');
}

function updateOverallStatus() {
    let totalTargetToNow = 0, totalActualToNow = 0;
    globalIntervals.forEach(inv => {
        if (!inv.isBreak && inv.actual > 0) {
            totalTargetToNow += inv.target;
            totalActualToNow += inv.actual;
        }
    });

    let variance = totalActualToNow - totalTargetToNow;
    if (totalTargetToNow === 0) variance = 0;

    let board = document.getElementById('mainStatusBoard');
    board.innerText = (variance > 0 ? '+' : '') + variance;
    board.className = 'kpi-value ' + (variance > 0 ? 'status-positive' : (variance < 0 ? 'status-negative' : 'status-neutral'));
}