import { API } from './api.js?v=20260817-dept-management-1';

const DEPARTMENT_MANAGEMENT_PASSWORD_HASH = 'd20fdf0c14354aad8439e23de3b404b66c5327cd60065e5db896caf55673630e';

async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const CONFIG = {
    GOOGLE_API_URL: "https://script.google.com/macros/s/AKfycbyVKapcO0hPx3j_d1HdHA6tOM8EX9etTzHmE9ZfvsldSI7lnFCMkuuSDdqH4mzr_HYecQ/exec",
    CLOUDINARY_CLOUD_NAME: "us3eggqq",
    CLOUDINARY_UPLOAD_PRESET: "production_system",
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
    fiveSNotificationsEnabled: true,
    fiveSClientId: '',
    fiveSKnownNoteIds: new Set(),
    fiveSNotesSnapshotReady: false,
    currentUser: null,
    authStateUnsubscribe: null,
    usersListener: null,
    sessionStartedForUid: null,
    
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
        fiveS: { locations: [], notes: [], monthlySummaries: [] },
        managedUsers: []
    },

    async init() {
        // تسجيل أحداث التثبيت يمكن أن يعمل قبل تسجيل الدخول، لكن لا يتم تشغيل بيانات التطبيق قبل المصادقة.
        window.addEventListener('beforeinstallprompt', (event) => {
            event.preventDefault();
            this.deferredPrompt = event;
            this.showInstallPrompt();
            if (this.installPromptResolver) {
                const resolvePrompt = this.installPromptResolver;
                this.installPromptResolver = null;
                resolvePrompt(event);
            }
        });
        window.addEventListener('appinstalled', () => {
            this.deferredPrompt = null;
            this.hideInstallPrompt();
            this.showToast('تم تثبيت نظام الإنتاج على جهازك بنجاح');
        });
        window.setTimeout(() => this.showInstallPrompt(), 2200);
        setTimeout(() => {
            const splash = document.getElementById('cinematic-splash');
            if (splash) { splash.style.opacity = '0'; setTimeout(() => splash.remove(), 800); }
        }, 1500);

        const loginForm = document.getElementById('login-form');
        if (loginForm) loginForm.addEventListener('submit', (event) => this.submitLogin(event));
        const forgotPasswordButton = document.getElementById('forgot-password-btn');
        if (forgotPasswordButton) forgotPasswordButton.addEventListener('click', () => this.requestPasswordReset());
        const toggleSignupBtn = document.getElementById('toggle-signup-btn');
        if (toggleSignupBtn) toggleSignupBtn.addEventListener('click', () => this.toggleAuthForms(true));
        const toggleLoginBtn = document.getElementById('toggle-login-btn');
        if (toggleLoginBtn) toggleLoginBtn.addEventListener('click', () => this.toggleAuthForms(false));
        const signupForm = document.getElementById('signup-form');
        if (signupForm) signupForm.addEventListener('submit', (event) => this.submitSignup(event));
        const logoutButton = document.getElementById('auth-logout-btn');
        if (logoutButton) logoutButton.addEventListener('click', () => this.logout());

        this.authStateUnsubscribe = API.auth.onAuthStateChanged(async (firebaseUser) => {
            if (!firebaseUser) {
                // Don't clear if we are in a master bypass session
                if (this.currentUser?.isBypass) {
                    if (this.sessionStartedForUid !== this.currentUser.uid) {
                        this.sessionStartedForUid = this.currentUser.uid;
                        await this.startAuthenticatedSession();
                    }
                    return;
                }
                
                this.currentUser = null;
                this.sessionStartedForUid = null;
                this.showLoginGate();
                return;
            }
            try {
                let profile = null;
                for (let attempt = 0; attempt < 5 && !profile; attempt += 1) {
                    profile = await API.auth.getProfile(firebaseUser.uid);
                    if (!profile) await new Promise(resolve => setTimeout(resolve, 300));
                }
                if (!profile || profile.active === false) throw new Error('account_not_configured');
                this.currentUser = { ...profile, uid: firebaseUser.uid, isMaster: profile.role === 'admin' && profile.usernameLower === 'mfayez' };
                this.showAuthenticatedShell();
                if (this.sessionStartedForUid !== firebaseUser.uid) {
                    this.sessionStartedForUid = firebaseUser.uid;
                    await this.startAuthenticatedSession();
                }
            } catch (error) {
                console.error('Authentication profile error:', error);
                await API.auth.logout().catch(() => {});
                this.showLoginGate(error.message === 'account_not_configured' ? 'الحساب غير مفعل أو لم يتم إعداد صلاحياته بعد' : 'تعذر تحميل صلاحيات الحساب');
            }
        });
    },

    async startAuthenticatedSession() {
        try {
            this.fiveSNotificationsEnabled = localStorage.getItem('production_system_5s_notifications') !== 'off';
        } catch (error) {
            this.fiveSNotificationsEnabled = true;
        }
        try {
            this.fiveSClientId = sessionStorage.getItem('production_system_5s_client_id') || `client_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
            sessionStorage.setItem('production_system_5s_client_id', this.fiveSClientId);
        } catch (error) {
            this.fiveSClientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        }
        this.lastNotificationId = Date.now();
        this.update5SNotificationButton();

        if (this.usersListener) {
            this.usersListener();
            this.usersListener = null;
        }
        if (this.currentUser?.isMaster) {
            this.usersListener = API.auth.listenToUsers((users) => {
                this.data.managedUsers = users;
                this.renderAdminUsersList();
            });
        }
        this.renderAdminPermissionControls();
        this.renderAdminUsersList();

        this.isOnline = await API.production.testConnection();
        this.updateConnectionStatus(this.isOnline);

        const today = new Date();
        const dateString = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        const globalDate = document.getElementById('global-date');
        const globalShift = document.getElementById('global-shift');
        if (globalDate) globalDate.value = dateString;
        if (globalShift) globalShift.value = '1';

        this.systemListenerUnsubscribe = API.system.listenToDepartments((depts) => {
            this.data.departments = depts;
            const visible = this.visibleDepartments();
            if (visible.length && !visible.includes(this.data.currentDepartment)) this.data.currentDepartment = visible[0];
            this.renderDepartmentSelector();
            this.renderSettingsDepartmentsList();
            this.render5SDepartmentOptions();
            this.render5SPlaceOptions();
            this.refreshPermissionedNavigation();
            this.applyPermissionedControls();
            if (!this.data.currentDepartment && depts.length > 0) {
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
        if (deptSelect) deptSelect.addEventListener('change', (event) => {
            this.data.currentDepartment = event.target.value;
            this.listenToCurrentDepartmentSettings();
        });
        if (globalDate) globalDate.addEventListener('change', () => this.loadDayData());
        if (globalShift) globalShift.addEventListener('change', () => this.loadDayData());
    },

    showLoginGate(message = '') {
        const gate = document.getElementById('auth-gate');
        const shell = document.getElementById('app-shell');
        if (gate) gate.style.display = 'flex';
        if (shell) shell.setAttribute('aria-hidden', 'true');
        const error = document.getElementById('login-error');
        if (error) { error.textContent = message; error.style.display = message ? 'block' : 'none'; }
        const username = document.getElementById('login-username');
        if (username) username.focus();
    },

    showAuthenticatedShell() {
        const gate = document.getElementById('auth-gate');
        const shell = document.getElementById('app-shell');
        if (gate) gate.style.display = 'none';
        if (shell) shell.setAttribute('aria-hidden', 'false');
        const name = document.getElementById('auth-user-name');
        const role = document.getElementById('auth-user-role');
        if (name) name.textContent = this.currentUser.username || '';
        if (role) role.textContent = this.currentUser.jobTitle || this.currentUser.role || '';
        
        const adminNav = document.querySelectorAll('[data-admin-only]');
        adminNav.forEach(item => { item.style.display = this.currentUser.isMaster ? '' : 'none'; });
        this.refreshPermissionedNavigation();
        this.applyPermissionedControls();
        this.renderDepartmentSelector();
        this.renderAdminPermissionControls();
        this.renderAdminUsersList();
    },

    visibleDepartments() {
        // Master admin always sees all departments
        if (this.currentUser?.isMaster) return [...this.data.departments];
        
        const allowed = Array.isArray(this.currentUser?.allowedDepartments) ? this.currentUser.allowedDepartments : [];
        if (allowed.includes('*')) return [...this.data.departments];
        
        // If no allowed departments defined but user is authenticated, default to none or check if it's a legacy account
        return this.data.departments.filter(department => allowed.includes(department));
    },

    permissionKey(screenId) {
        return screenId === '5s' ? 'fiveS' : screenId;
    },

    canView(screenId) {
        if (!this.currentUser) return false;
        if (this.currentUser.isMaster) return true;
        const key = this.permissionKey(screenId);
        return this.currentUser.permissions?.view?.[key] === true && this.visibleDepartments().length > 0;
    },

    canEdit(scope) {
        if (!this.currentUser) return false;
        if (this.currentUser.isMaster) return true;
        return this.currentUser.permissions?.edit?.[scope] === true && this.visibleDepartments().length > 0;
    },

    hasAnyViewPermission() {
        return ['production', 'balances', 'quality', 'fiveS', 'analytics', 'settings'].some((screen) => this.canView(screen));
    },

    refreshPermissionedNavigation() {
        if (!this.currentUser) return;
        document.querySelectorAll('.bottom-nav .nav-item[data-target]').forEach((item) => {
            const target = item.dataset.target;
            const allowed = target === 'admin'
                ? this.currentUser.isMaster
                : target === 'home'
                    ? this.currentUser.isMaster || this.hasAnyViewPermission()
                    : target === 'settings'
                        ? this.currentUser.isMaster || this.canView('settings')
                        : this.canView(target);
            item.style.display = allowed ? '' : 'none';
            item.setAttribute('aria-hidden', allowed ? 'false' : 'true');
        });
        document.querySelectorAll('[data-factory-only="true"]').forEach((item) => {
            item.style.display = this.currentUser.isMaster ? '' : 'none';
        });
    },

    applyPermissionedControls() {
        const qualityEditable = this.canEdit('quality');
        const fiveSEditable = this.canEdit('fiveS');
        const settingsEditable = this.canEdit('settings');
        const balanceEditable = this.canEdit('balances');
        const productionEditable = this.canEdit('production');
        const masterOnly = this.currentUser?.isMaster === true;
        const productionTarget = document.getElementById('prod-target');
        if (productionTarget) productionTarget.readOnly = !productionEditable;
        ['scratch-model', 'scratch-type', 'scratch-image', 'scratch-notes'].forEach((id) => {
            const input = document.getElementById(id);
            if (input) input.disabled = !qualityEditable;
        });
        const newDepartmentInput = document.getElementById('new-department-name');
        if (newDepartmentInput) newDepartmentInput.disabled = !masterOnly;
        const newDefectTypeInput = document.getElementById('new-defect-type');
        if (newDefectTypeInput) newDefectTypeInput.disabled = !settingsEditable;
        const fiveSEntry = document.getElementById('5s-entry-card');
        if (fiveSEntry) fiveSEntry.style.display = fiveSEditable ? '' : 'none';
        const qualityEntry = document.getElementById('quality-entry-card');
        if (qualityEntry) qualityEntry.style.display = qualityEditable ? '' : 'none';
        const addDefectTypeButton = document.getElementById('add-defect-type-btn');
        if (addDefectTypeButton) addDefectTypeButton.disabled = !settingsEditable;
        const departmentManagement = document.getElementById('department-management-card');
        if (departmentManagement) departmentManagement.style.display = this.currentUser?.isMaster ? '' : 'none';
        const resetCard = document.getElementById('settings-reset-card');
        if (resetCard) resetCard.style.display = this.currentUser?.isMaster ? '' : 'none';
        ['set-line-name', 'set-shift-start', 'set-shift-end', 'set-break-start', 'set-break-end'].forEach((id) => {
            const input = document.getElementById(id);
            if (input) input.readOnly = !settingsEditable;
        });
        const addModelCard = document.getElementById('add-model-card');
        if (addModelCard && this.currentBalanceTab === 'cabinet') addModelCard.style.display = balanceEditable ? '' : 'none';
    },

    requireView(screenId) {
        if (this.canView(screenId)) return true;
        this.showToast('ليس لديك صلاحية عرض هذه الصفحة', true);
        return false;
    },

    requireEdit(scope) {
        if (this.canEdit(scope)) return true;
        this.showToast('ليس لديك صلاحية تعديل هذه البيانات', true);
        return false;
    },

    getLoginSecurityState() {
        try {
            const stored = JSON.parse(localStorage.getItem('production_system_login_security_v1') || '{}');
            return {
                failures: Number.isFinite(Number(stored.failures)) ? Math.max(0, Number(stored.failures)) : 0,
                lockedUntil: Number.isFinite(Number(stored.lockedUntil)) ? Math.max(0, Number(stored.lockedUntil)) : 0
            };
        } catch (error) {
            return { failures: 0, lockedUntil: 0 };
        }
    },

    saveLoginSecurityState(state) {
        try { localStorage.setItem('production_system_login_security_v1', JSON.stringify(state)); } catch (error) { /* لا نعتمد على التخزين المحلي كطبقة أمان وحيدة */ }
    },

    getLoginLockRemainingSeconds() {
        const remaining = Math.ceil((this.getLoginSecurityState().lockedUntil - Date.now()) / 1000);
        return Math.max(0, remaining);
    },

    registerLoginFailure() {
        const state = this.getLoginSecurityState();
        const now = Date.now();
        if (state.lockedUntil && state.lockedUntil <= now) {
            state.failures = 0;
            state.lockedUntil = 0;
        }
        state.failures += 1;
        if (state.failures >= 5) {
            state.failures = 0;
            state.lockedUntil = now + 30 * 1000;
        }
        this.saveLoginSecurityState(state);
        return this.getLoginLockRemainingSeconds();
    },

    clearLoginSecurityState() {
        this.saveLoginSecurityState({ failures: 0, lockedUntil: 0 });
    },

    setLoginMessage(message, isError = true) {
        const element = document.getElementById('login-error');
        if (!element) return;
        element.textContent = message || '';
        element.classList.toggle('auth-success', !isError);
        element.classList.toggle('auth-error', isError);
        element.style.display = message ? 'block' : 'none';
    },

    toggleAuthForms(toSignup = true) {
        const loginForm = document.getElementById('login-form');
        const signupForm = document.getElementById('signup-form');
        const title = document.querySelector('.auth-card h1');
        const subtitle = document.querySelector('.auth-subtitle');
        if (!loginForm || !signupForm) return;
        
        this.setLoginMessage('');
        this.setSignupMessage('');
        
        if (toSignup) {
            loginForm.style.display = 'none';
            signupForm.style.display = 'block';
            if (title) title.textContent = 'إنشاء حساب جديد';
            if (subtitle) subtitle.textContent = 'سجل بياناتك وسيتم تفعيل حسابك من قبل الإدارة فوراً.';
        } else {
            loginForm.style.display = 'block';
            signupForm.style.display = 'none';
            if (title) title.textContent = 'تسجيل الدخول';
            if (subtitle) subtitle.textContent = 'أدخل بيانات حسابك للوصول إلى النظام حسب الصلاحيات الممنوحة لك.';
        }
    },

    setSignupMessage(message, isError = true) {
        const element = document.getElementById('signup-error');
        if (!element) return;
        element.textContent = message || '';
        element.classList.toggle('auth-success', !isError);
        element.classList.toggle('auth-error', isError);
        element.style.display = message ? 'block' : 'none';
    },

    async submitSignup(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const username = form.querySelector('[name="username"]')?.value || '';
        const password = form.querySelector('[name="password"]')?.value || '';
        const jobTitle = form.querySelector('[name="jobTitle"]')?.value || '';
        const button = form.querySelector('button[type="submit"]');
        
        if (button) button.disabled = true;
        this.setSignupMessage('');
        
        try {
            await API.auth.signup(username, password, jobTitle);
            this.setSignupMessage('تم إنشاء الحساب بنجاح! يرجى التواصل مع المدير لتفعيل حسابك.', false);
            setTimeout(() => this.toggleAuthForms(false), 3000);
        } catch (error) {
            const messages = {
                invalid_username: 'اسم المستخدم يجب أن يكون بالإنجليزية وبدون مسافات',
                weak_password: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل',
                'auth/email-already-in-use': 'اسم المستخدم هذا مسجل بالفعل'
            };
            this.setSignupMessage(messages[error.message] || messages[error.code] || 'تعذر إنشاء الحساب. حاول لاحقاً.', true);
        } finally {
            if (button) button.disabled = false;
        }
    },

    async submitLogin(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const username = form.querySelector('[name="username"]')?.value || '';
        const password = form.querySelector('[name="password"]')?.value || '';
        const button = form.querySelector('button[type="submit"]');
        const remaining = this.getLoginLockRemainingSeconds();
        if (remaining > 0) {
            this.setLoginMessage(`تم إيقاف محاولات الدخول مؤقتاً. حاول بعد ${remaining} ثانية.`, true);
            return;
        }
        if (button) button.disabled = true;
        this.setLoginMessage('');
        try {
            const profile = await API.auth.login(username, password);
            this.clearLoginSecurityState();
            
            // If it's a bypass login (Firebase Auth failed but master password correct)
            if (profile && profile.isBypass) {
                this.currentUser = profile;
                this.showAuthenticatedShell();
                if (this.sessionStartedForUid !== profile.uid) {
                    this.sessionStartedForUid = profile.uid;
                    await this.startAuthenticatedSession();
                }
            }
        } catch (loginError) {
            const lockRemaining = this.registerLoginFailure();
            const messages = {
                invalid_username: 'اكتب اسم مستخدم صحيحاً باللغة الإنجليزية',
                missing_password: 'أدخل كلمة المرور',
                account_not_configured: 'الحساب غير مفعل أو لم يمنحه المدير صلاحيات بعد',
                'auth/invalid-credential': 'اسم المستخدم أو كلمة المرور غير صحيحة',
                'auth/too-many-requests': 'تم إيقاف المحاولات مؤقتاً من Firebase. حاول لاحقاً'
            };
            const message = lockRemaining > 0
                ? `تم إيقاف محاولات الدخول مؤقتاً. حاول بعد ${lockRemaining} ثانية.`
                : (messages[loginError.message] || messages[loginError.code] || 'تعذر تسجيل الدخول');
            this.setLoginMessage(message, true);
        } finally {
            if (button) button.disabled = false;
        }
    },

    async requestPasswordReset() {
        const username = document.getElementById('login-username')?.value || '';
        const button = document.getElementById('forgot-password-btn');
        let cooldownUntil = 0;
        try { cooldownUntil = Number(sessionStorage.getItem('production_system_reset_cooldown_until') || 0); } catch (error) { cooldownUntil = 0; }
        const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
        if (remaining > 0) {
            this.setLoginMessage(`تم إرسال طلب حديثاً. حاول بعد ${remaining} ثانية.`, true);
            return;
        }
        if (!/^[a-z0-9._-]{3,40}$/i.test(String(username).trim())) {
            this.setLoginMessage('اكتب اسم المستخدم أولاً ثم اضغط "نسيت كلمة المرور؟"', true);
            return;
        }
        if (button) button.disabled = true;
        this.setLoginMessage('');
        try {
            await API.auth.requestPasswordReset(username);
            try { sessionStorage.setItem('production_system_reset_cooldown_until', String(Date.now() + 60 * 1000)); } catch (error) { /* اختياري */ }
            this.setLoginMessage('إذا كان الحساب موجوداً، فسيتم إرسال رسالة إعادة تعيين كلمة المرور إلى البريد الإلكتروني المسجل للحساب.', false);
        } catch (resetError) {
            const knownError = ['auth/invalid-email', 'auth/user-not-found', 'auth/invalid-credential'].includes(resetError.code);
            this.setLoginMessage(knownError ? 'تعذر إرسال رسالة الاستعادة. تأكد من اسم المستخدم أو تواصل مع المدير الرئيسي.' : 'تعذر إرسال رسالة إعادة تعيين كلمة المرور. حاول لاحقاً.', true);
        } finally {
            if (button) button.disabled = false;
        }
    },

    async logout() {
        if (!confirm('هل تريد تسجيل الخروج من النظام؟')) return;
        await API.auth.logout();
        window.location.reload();
    },

    toggleSidebar(force) {
        // Sidebar removed as per user request to restore original look
    },

    renderAdminPermissionControls() {
        if (!this.currentUser?.isMaster) return;
        const departmentsContainer = document.getElementById('admin-department-permissions');
        const screensContainer = document.getElementById('admin-screen-permissions');
        if (departmentsContainer) {
            const departments = this.data.departments.length ? this.data.departments : ['*'];
            departmentsContainer.innerHTML = `
                <label class="check-container admin-all-check"><input type="checkbox" data-admin-dept="*" checked><span class="checkmark"></span> كل الأقسام</label>
                ${departments.filter(Boolean).map(department => `<label class="check-container"><input type="checkbox" data-admin-dept="${this.escapeHtml(department)}"><span class="checkmark"></span>${this.escapeHtml(department)}</label>`).join('')}
            `;
            const allBox = departmentsContainer.querySelector('[data-admin-dept="*"]');
            const boxes = [...departmentsContainer.querySelectorAll('input[data-admin-dept]:not([data-admin-dept="*"])')];
            allBox?.addEventListener('change', () => {
                boxes.forEach(box => { box.checked = false; box.disabled = allBox.checked; });
            });
            boxes.forEach(box => box.addEventListener('change', () => {
                if (box.checked) { allBox.checked = false; allBox.disabled = false; }
                if (!boxes.some(item => item.checked)) { allBox.checked = true; allBox.disabled = false; boxes.forEach(item => { item.disabled = true; item.checked = false; }); }
            }));
            boxes.forEach(box => { box.disabled = true; });
        }
        if (screensContainer) {
            const screens = [
                ['production', 'الإنتاج'], ['quality', 'الجودة'], ['balances', 'الأرصدة'],
                ['fiveS', 'ملاحظات 5S'], ['analytics', 'التقارير'], ['settings', 'الإعدادات']
            ];
            screensContainer.innerHTML = screens.map(([key, label]) => `
                <div class="permission-row"><strong>${label}</strong><label class="check-container"><input type="checkbox" data-admin-view="${key}" checked><span class="checkmark"></span>عرض</label><label class="check-container"><input type="checkbox" data-admin-edit="${key}"><span class="checkmark"></span>تعديل</label></div>
            `).join('');
        }
    },

    renderAdminUsersList() {
        const container = document.getElementById('admin-users-list');
        if (!container || !this.currentUser?.isMaster) return;
        const users = this.data.managedUsers || [];
        if (!users.length) {
            container.innerHTML = '<div class="empty-state">لا يوجد مستخدمون مُضافون بعد.</div>';
            return;
        }
        container.innerHTML = users.map(user => {
            const isMaster = user.usernameLower === 'mfayez';
            const departments = Array.isArray(user.allowedDepartments) && user.allowedDepartments.includes('*') ? 'كل الأقسام' : (user.allowedDepartments || []).join('، ') || 'لا توجد أقسام';
            const status = user.active === false ? 'موقوف' : 'نشط';
            const action = isMaster ? '<span class="admin-master-badge">MASTER</span>' : `<button type="button" class="admin-user-action ${user.active === false ? 'is-active' : 'is-danger'}" onclick="App.toggleManagedUser('${user.uid}', ${user.active === false})">${user.active === false ? 'تفعيل' : 'إيقاف'}</button>`;
            return `<article class="admin-user-card"><div class="admin-user-main"><div class="admin-user-avatar"><i class="fa-solid fa-user"></i></div><div><strong>${this.escapeHtml(user.username || '')}</strong><small>${this.escapeHtml(user.jobTitle || user.role || '')} · ${status}</small><span>${this.escapeHtml(departments)}</span></div></div><div class="admin-user-actions">${action}</div></article>`;
        }).join('');
    },

    async createManagedUser() {
        if (!this.currentUser?.isMaster) { this.showToast('هذه العملية متاحة للمدير الرئيسي فقط', true); return; }
        const username = document.getElementById('admin-username')?.value.trim() || '';
        const password = document.getElementById('admin-password')?.value || '';
        const jobTitle = document.getElementById('admin-job-title')?.value || 'فني';
        const role = document.getElementById('admin-role')?.value || 'viewer';
        const departmentBoxes = [...document.querySelectorAll('#admin-department-permissions input[data-admin-dept]')];
        const allDepartments = departmentBoxes.find(box => box.dataset.adminDept === '*')?.checked;
        const allowedDepartments = allDepartments ? ['*'] : departmentBoxes.filter(box => box.checked).map(box => box.dataset.adminDept);
        const view = {};
        const edit = {};
        document.querySelectorAll('#admin-screen-permissions input[data-admin-view]').forEach(box => { view[box.dataset.adminView] = box.checked; });
        document.querySelectorAll('#admin-screen-permissions input[data-admin-edit]').forEach(box => { edit[box.dataset.adminEdit] = box.checked; });
        if (!username || !password || !allowedDepartments.length) { this.showToast('أكمل اسم المستخدم وكلمة المرور والأقسام المسموح بها', true); return; }
        if (!Object.values(view).some(Boolean)) { this.showToast('اختر صفحة واحدة على الأقل للعرض', true); return; }
        try {
            await API.auth.createUser({ username, password, role, jobTitle, allowedDepartments, permissions: { view, edit } });
            this.showToast('تم إنشاء المستخدم وحفظ صلاحياته بنجاح');
            ['admin-username', 'admin-password'].forEach(id => { const input = document.getElementById(id); if (input) input.value = ''; });
        } catch (error) {
            const messages = { username_exists: 'اسم المستخدم موجود بالفعل', weak_password: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل', invalid_username: 'اسم المستخدم يجب أن يكون باللغة الإنجليزية وبدون مسافات' };
            this.showToast(messages[error.message] || 'تعذر إنشاء المستخدم', true);
        }
    },

    async toggleManagedUser(uid, shouldActivate) {
        if (!this.currentUser?.isMaster || !uid) return;
        try {
            if (shouldActivate) await API.auth.updateUser(uid, { active: true });
            else if (confirm('هل تريد إيقاف هذا المستخدم ومنعه من الدخول؟')) await API.auth.deactivateUser(uid);
            this.showToast(shouldActivate ? 'تم تفعيل المستخدم' : 'تم إيقاف المستخدم');
        } catch (error) {
            this.showToast('تعذر تحديث حالة المستخدم', true);
        }
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
        this.visibleDepartments().forEach(dept => { select.innerHTML += `<option value="${dept}">${dept}</option>`; });
        if(this.data.currentDepartment && this.visibleDepartments().includes(this.data.currentDepartment)) select.value = this.data.currentDepartment;
    },

    renderSettingsDepartmentsList() {
        const container = document.getElementById('departments-list');
        if (!container) return;
        container.innerHTML = '';
        this.data.departments.forEach((dept, index) => {
            const deleteBtn = this.data.departments.length > 1 ? `<i class="fa-solid fa-xmark text-red department-action-btn" title="حذف القسم" onclick="App.removeDepartment(${index})"></i>` : '';
            const renameBtn = `<i class="fa-solid fa-pen-to-square text-blue department-action-btn" title="تغيير اسم القسم بكلمة مرور" onclick="App.renameDepartment(${index})"></i>`;
            container.innerHTML += `<div class="defect-badge-setting"><span>${dept}</span><span class="department-setting-actions">${renameBtn}${deleteBtn}</span></div>`;
        });
    },

    async verifyDepartmentManagementPassword(actionLabel = 'إدارة الأقسام') {
        const password = prompt(`أدخل كلمة المرور للسماح بعملية ${actionLabel}:`);
        if (password === null) return false;
        if (await sha256Hex(password) !== DEPARTMENT_MANAGEMENT_PASSWORD_HASH) {
            this.showToast('كلمة المرور غير صحيحة', true);
            return false;
        }
        return true;
    },

    async renameDepartment(index) {
        if (!this.currentUser?.isMaster) { this.showToast('إدارة الأقسام متاحة للمدير الرئيسي فقط', true); return; }
        const oldName = this.data.departments[index];
        if (!oldName) return;

        if (!await this.verifyDepartmentManagementPassword('تغيير اسم القسم')) return;

        const newName = prompt(`اكتب الاسم الجديد للقسم:\nالاسم الحالي: ${oldName}`, oldName);
        if (newName === null) return;
        const trimmedName = newName.trim();
        if (!trimmedName || trimmedName === oldName) return;
        if (this.data.departments.includes(trimmedName)) {
            this.showToast('هذا الاسم موجود بالفعل', true);
            return;
        }
        if (!confirm(`سيتم نقل بيانات القسم من «${oldName}» إلى «${trimmedName}». هل تريد المتابعة؟`)) return;

        const nextDepartments = this.data.departments.map((department, departmentIndex) => departmentIndex === index ? trimmedName : department);
        try {
            await API.system.renameDepartment(oldName, trimmedName, nextDepartments);
            this.data.departments = nextDepartments;
            if (this.data.currentDepartment === oldName) {
                this.data.currentDepartment = trimmedName;
                this.listenToCurrentDepartmentSettings();
            }
            this.renderDepartmentSelector();
            this.renderSettingsDepartmentsList();
            this.render5SDepartmentOptions();
            this.render5SPlaceOptions();
            this.showToast('تم تغيير اسم القسم ونقل بياناته بنجاح');
        } catch (error) {
            console.error('Department rename failed:', error);
            this.showToast('تعذر تغيير اسم القسم. لم يتم تعديل القائمة.', true);
        }
    },

    async addDepartment() {
        if (!this.currentUser?.isMaster) { this.showToast('إدارة الأقسام متاحة للمدير الرئيسي فقط', true); return; }
        const input = document.getElementById('new-department-name');
        if (!input) return;
        const val = input.value.trim();
        if (val === '') return;
        if (this.data.departments.includes(val)) {
            this.showToast('هذا القسم موجود بالفعل', true);
            return;
        }
        if (!await this.verifyDepartmentManagementPassword('إضافة قسم جديد')) return;

        this.data.departments.push(val);
        await API.system.saveDepartments(this.data.departments);
        input.value = '';
        this.renderDepartmentSelector();
        this.renderSettingsDepartmentsList();
        this.render5SDepartmentOptions();
        this.render5SPlaceOptions();
        this.showToast('تم إضافة القسم الجديد');
    },

    async removeDepartment(index) {
        if (!this.currentUser?.isMaster) { this.showToast('إدارة الأقسام متاحة للمدير الرئيسي فقط', true); return; }
        const removedDept = this.data.departments[index];
        if (!removedDept || this.data.departments.length <= 1) return;
        if (!await this.verifyDepartmentManagementPassword('حذف القسم')) return;
        if (!confirm(`حذف القسم «${removedDept}» سيمنع الوصول إليه من القائمة وقد يخفي بياناته السابقة. هل أنت متأكد؟`)) return;

        this.data.departments.splice(index, 1);
        await API.system.saveDepartments(this.data.departments);
        if (this.data.currentDepartment === removedDept) {
            this.data.currentDepartment = this.data.departments[0];
            const deptSelect = document.getElementById('global-department');
            if (deptSelect) deptSelect.value = this.data.currentDepartment;
            this.listenToCurrentDepartmentSettings();
        }
        this.renderDepartmentSelector();
        this.renderSettingsDepartmentsList();
        this.render5SDepartmentOptions();
        this.render5SPlaceOptions();
        this.showToast('تم حذف القسم من القائمة');
    },

    listenToCurrentDepartmentSettings() {
        if(this.currentSettingsListener) this.currentSettingsListener();
        this.currentSettingsListener = API.settings.listenToSettings(this.data.currentDepartment, (cloudSettings) => {
            if(cloudSettings) {
                this.data.settings = cloudSettings;
            } else {
                this.data.settings = { start: '07:30', end: '16:00', bStart: '12:30', bEnd: '13:30', lineName: this.data.currentDepartment, defectTypes: ['خدش خفيف'] };
                if (this.canEdit('settings')) API.settings.saveSettings(this.data.currentDepartment, this.data.settings);
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
        const permissionScreen = ['defects_log', 'scratches'].includes(screenId) ? 'quality' : screenId;
        const canOpenHome = screenId === 'home' && (this.currentUser?.isMaster || this.hasAnyViewPermission());
        if (screenId !== 'admin' && screenId !== 'home' && !this.requireView(permissionScreen)) return;
        if (screenId === 'home' && !canOpenHome) {
            this.showToast('لا توجد صفحات متاحة لهذا الحساب', true);
            return;
        }
        if (screenId === 'admin' && !this.currentUser?.isMaster) {
            this.showToast('لوحة الإدارة متاحة للمدير الرئيسي فقط', true);
            return;
        }
        this.currentScreen = screenId;
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const targetScreen = document.getElementById('screen-' + screenId);
        if(targetScreen) targetScreen.classList.add('active');
        
        document.querySelectorAll('.nav-item, .sidebar-nav-item').forEach(n => n.classList.remove('active'));
        const navTarget = screenId === 'defects_log' || screenId === 'scratches' ? 'quality' : screenId;
        document.querySelectorAll(`.nav-item[data-target="${navTarget}"], .sidebar-nav-item[data-target="${navTarget}"]`).forEach((navBtn) => navBtn.classList.add('active'));
        
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
        if (!this.currentUser) return this.showLoginGate();
        if (!this.currentUser.isMaster && !this.canView('settings')) {
            this.showToast('الإعدادات متاحة للمستخدمين المصرح لهم فقط', true);
            return;
        }
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
        if (!this.requireEdit('settings')) return;
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
        const productionEditable = this.canEdit('production');
        const editAttribute = productionEditable ? '' : 'readonly aria-readonly="true"';
        container.innerHTML = '';
        this.data.generatedHours.forEach(timeSlot => {
            if (timeSlot.isBreak) {
                container.innerHTML += `<div class="hour-row break-row"><span>${timeSlot.label}</span></div>`;
            } else {
                container.innerHTML += `
                    <div class="hour-row" id="row-${timeSlot.rawTime.replace(':','-')}" data-hour="${timeSlot.rawTime}">
                        <div class="hour-header">
                            <span class="time-label">${timeSlot.label}</span>
                            <input type="number" class="actual-input" placeholder="0" ${editAttribute}
                                oninput="App.handleProdInput('${timeSlot.rawTime}')">
                        </div>
                        <input type="text" class="reason-input" placeholder="سبب العجز (إن وجد)..." ${editAttribute}
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
        if (this.currentInventoryListener) this.currentInventoryListener();
        if (this.fiveSNotesListener) this.fiveSNotesListener();
        this.fiveSNotesSnapshotReady = false;
        this.fiveSKnownNoteIds = new Set();

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

        const allowedMasterScope = this.currentUser?.isMaster ? ['*'] : this.visibleDepartments();
        this.masterProdListener = API.master.listenToScopedProduction(allowedMasterScope, date, shift, (records) => {
            this.data.master.production = records;
            if(this.currentScreen === 'home' || this.currentScreen === 'analytics') {
                this.renderMasterDashboard();
                if(this.currentScreen === 'analytics') this.renderAnalytics();
            }
        });
        this.masterTargetListener = API.master.listenToScopedTargets(allowedMasterScope, date, shift, (records) => {
            this.data.master.targets = records;
            if(this.currentScreen === 'home' || this.currentScreen === 'analytics') {
                this.renderMasterDashboard();
                if(this.currentScreen === 'analytics') this.renderAnalytics();
            }
        });
        this.masterDefectListener = API.master.listenToScopedScratches(allowedMasterScope, date, (records) => {
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
            const incomingIds = new Set(records.map((note) => String(note.id || '')));
            if (!this.fiveSNotesSnapshotReady) {
                this.fiveSKnownNoteIds = incomingIds;
                this.fiveSNotesSnapshotReady = true;
            } else {
                records.forEach((note) => {
                    const noteId = String(note.id || '');
                    if (!noteId || this.fiveSKnownNoteIds.has(noteId)) return;
                    this.fiveSKnownNoteIds.add(noteId);
                    if (note.createdByClientId !== this.fiveSClientId && this.fiveSNotificationsEnabled) {
                        this.showSystemNotification(
                            `ملاحظة 5S جديدة في ${note.place || 'مكان غير محدد'}`,
                            `${note.department || 'قسم غير محدد'}\n${note.description || 'تم تسجيل ملاحظة جديدة'}`
                        );
                    }
                });
                this.fiveSKnownNoteIds = incomingIds;
            }
            this.data.fiveS.notes = records;
            if (this.currentScreen === '5s') this.render5SNotes();
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
        if (!this.requireEdit('production')) return;
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
        if (!this.requireEdit('production')) return;
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
        const dashboardDepartments = this.visibleDepartments();
        const isMaster = this.currentUser?.isMaster === true;
        let factoryTotalActual = 0;
        let factoryTotalTarget = 0;
        let deptProd = {};
        let deptScratches = {};

        dashboardDepartments.forEach(d => {
            deptProd[d] = {};
            deptScratches[d] = 0;
        });

        if(this.data.master.production) {
            this.data.master.production.forEach(r => {
                if(r.department && dashboardDepartments.includes(r.department)) {
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
                if(r.department && dashboardDepartments.includes(r.department)) {
                    validTargets[r.department] = Number(r.target) || 0;
                }
            });
        }
        
        factoryTotalTarget = isMaster
            ? (validTargets['التجميع النهائي'] || 0)
            : dashboardDepartments.reduce((sum, department) => sum + (validTargets[department] || 0), 0);

        if(this.data.master.scratches) {
            this.data.master.scratches.forEach(r => {
                if(r.department && deptScratches[r.department] !== undefined) {
                    deptScratches[r.department] += 1;
                }
            });
        }

        let finalDeptProdTotals = {};
        dashboardDepartments.forEach(d => {
            const sum = Object.values(deptProd[d]).reduce((acc, val) => acc + val, 0);
            finalDeptProdTotals[d] = sum;
            if (isMaster ? d === 'التجميع النهائي' : true) {
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
            dashboardDepartments.forEach(dept => {
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

        const depts = dashboardDepartments;
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
        if(addCard) addCard.style.display = tabId === 'final' || !this.canEdit('balances') ? 'none' : 'block';
        
        this.renderInventory();
    },

    addInventoryModel() {
        if (!this.requireEdit('balances')) return;
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
        if (!this.requireEdit('balances')) return;
        if(!confirm('هل أنت متأكد من حذف هذا الموديل بأرصدته؟')) return;
        
        this.data.inventory.models = this.data.inventory.models.filter(m => m.id !== modelId);
        delete this.data.inventory.cabinet[modelId];
        delete this.data.inventory.door[modelId];
        
        API.balances.saveInventory(this.data.inventory);
        this.showToast('تم حذف الموديل');
    },

    handleInventoryInput(modelId, part, field) {
        if (!this.requireEdit('balances')) return;
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
        const balanceEditable = this.canEdit('balances');
        const inventoryEditAttribute = balanceEditable ? '' : 'readonly aria-readonly="true"';
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
                            <input type="number" id="inv_cabinet_${model.id}_boq" class="inv-input" placeholder="0" value="${cabData.boq}" ${inventoryEditAttribute} oninput="App.handleInventoryInput('${model.id}', 'cabinet', 'boq')">
                        </div>
                        <div class="inv-input-group">
                            <label>خارج المقايسة</label>
                            <input type="number" id="inv_cabinet_${model.id}_out" class="inv-input" placeholder="0" value="${cabData.out}" ${inventoryEditAttribute} oninput="App.handleInventoryInput('${model.id}', 'cabinet', 'out')">
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
                        <input type="number" id="inv_door_${model.id}_v" class="inv-input" placeholder="0" value="${doorData.v}" ${inventoryEditAttribute} oninput="App.handleInventoryInput('${model.id}', 'door', 'v')">
                    </div>` : '';

                contentHtml = `
                    <div class="inv-inputs-grid" style="grid-template-columns: ${gridCols};">
                        <div class="inv-input-group">
                            <label>باب R</label>
                            <input type="number" id="inv_door_${model.id}_r" class="inv-input" placeholder="0" value="${doorData.r}" ${inventoryEditAttribute} oninput="App.handleInventoryInput('${model.id}', 'door', 'r')">
                        </div>
                        <div class="inv-input-group">
                            <label>باب F</label>
                            <input type="number" id="inv_door_${model.id}_f" class="inv-input" placeholder="0" value="${doorData.f}" ${inventoryEditAttribute} oninput="App.handleInventoryInput('${model.id}', 'door', 'f')">
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
                            ${balanceEditable ? `<i class="fa-solid fa-trash-can text-red ml-2" style="cursor:pointer; margin-right:10px;" onclick="App.deleteInventoryModel('${model.id}')"></i>` : ''}
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
        const settingsEditable = this.canEdit('settings');
        this.data.settings.defectTypes.forEach((type, index) => {
            const deleteIcon = settingsEditable ? `<i class="fa-solid fa-xmark text-red" onclick="App.removeDefectType(${index})"></i>` : '';
            container.innerHTML += `<div class="defect-badge-setting"><span>${this.escapeHtml(type)}</span>${deleteIcon}</div>`;
            selectMenu.innerHTML += `<option value="${this.escapeHtml(type)}">${this.escapeHtml(type)}</option>`;
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
        if (!this.requireEdit('settings')) return;
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
        if (!this.requireEdit('settings')) return;
        if(confirm("حذف هذا التصنيف من القسم الحالي؟")) {
            this.data.settings.defectTypes.splice(index, 1); 
            API.settings.saveSettings(this.data.currentDepartment, this.data.settings);
        }
    },

    addScratchDefect() {
        if (!this.requireEdit('quality')) return;
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
                try {
                    const imageUrl = await App.uploadToCloudinary(compressedBase64, "QualityDefects");
                    defectBase.image = imageUrl;
                    await API.quality.saveDefect(this.data.currentDepartment, defectBase);
                    if(notesEl) notesEl.value = ''; if(fileInput) fileInput.value = ''; App.showToast("تم الرفع والتسجيل بنجاح ✅");
                } catch (err) {
                    console.error("Upload error:", err);
                    App.showToast("فشل الرفع لـ Cloudinary ❌", true);
                } finally { if(loader) loader.classList.remove('show'); }
            }; img.src = e.target.result;
        }; reader.readAsDataURL(file);
    },

    renderScratchesList() {
        const container = document.getElementById('scratches-list'); 
        if(!container) return; container.innerHTML = '';
        
        let countToday = 0; let countFixed = 0; let countPending = 0;
        const canEditQuality = this.canEdit('quality');
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
            const statusHtml = canEditQuality
                ? `<span class="defect-badge ${statusClass}" onclick="App.toggleScratchStatus(${defect.id}, '${defect.status}')">${statusText}</span>`
                : `<span class="defect-badge ${statusClass}">${statusText}</span>`;
            const deleteHtml = canEditQuality ? `<i class="fa-solid fa-trash-can text-red" style="cursor:pointer; font-size: 1.2rem;" onclick="App.deleteScratch(${defect.id})"></i>` : '';

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
                            ${statusHtml}
                            ${deleteHtml}
                        </div>
                    </div>
                </div>
            `;
        });
    },

    toggleScratchStatus(id, currentStatus) { if (!this.requireEdit('quality')) return; const newStatus = currentStatus === 'pending' ? 'fixed' : 'pending'; API.quality.saveDefect(this.data.currentDepartment, { id: id, status: newStatus }); },
    deleteScratch(id) { if (!this.requireEdit('quality')) return; if(confirm("مسح السجل نهائياً؟")) API.quality.deleteDefect(id); },
    openImage(src) { const modalImg = document.getElementById('modal-image'); const modal = document.getElementById('image-modal'); if(modalImg && modal) { modalImg.src = src; modal.classList.add('show'); } },
    closeImageModal(e) { const modal = document.getElementById('image-modal'); if(modal && (e.target.id === 'image-modal' || e.target.classList.contains('fa-xmark') || e.target.classList.contains('close-modal-btn'))) { modal.classList.remove('show'); } },
    extractDriveFileId(url) {
        const value = String(url || '').trim();
        if (!value) return '';
        const match = value.match(/[?&]id=([^&]+)/i) || value.match(/googleusercontent\.com\/d\/([^/?#]+)/i) || value.match(/drive\.google\.com\/file\/d\/([^/?#]+)/i) || value.match(/drive\.google\.com\/d\/([^/?#]+)/i);
        return match && match[1] ? decodeURIComponent(match[1]) : '';
    },
    getDriveImageUrl(url) {
        const id = this.extractDriveFileId(url);
        return id ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1600` : String(url || '');
    },
    getImageUrl(url) {
        const value = String(url || '').trim();
        if (!value) return '';
        if (value.includes('cloudinary.com')) return value; // Cloudinary links are direct
        if (value.includes('drive.google.com') || value.includes('googleusercontent.com')) return this.getDriveImageUrl(value);
        return value;
    },
    async uploadToCloudinary(base64, folder = "ProductionSystem") {
        try {
            // Convert base64 to Blob for better compatibility
            const parts = base64.split(',');
            const byteString = atob(parts[1]);
            const mimeString = parts[0].split(':')[1].split(';')[0];
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }
            const blob = new Blob([ab], {type: mimeString});

            const formData = new FormData();
            formData.append("file", blob);
            formData.append("upload_preset", String(CONFIG.CLOUDINARY_UPLOAD_PRESET || '').trim());
            formData.append("folder", folder);
            
            // Using the generic upload endpoint which is often more stable
            const url = `https://api.cloudinary.com/v1_1/${CONFIG.CLOUDINARY_CLOUD_NAME}/upload`;
            
            const response = await fetch(url, {
                method: "POST",
                body: formData
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                console.error("Cloudinary Error Detail:", errorData);
                throw new Error(errorData.error ? errorData.error.message : "Cloudinary upload failed");
            }
            
            const data = await response.json();
            return data.secure_url;
        } catch (err) {
            console.error("Cloudinary Catch Error:", err);
            throw err;
        }
    },

    // ---------------- التقارير والتحليلات الشاملة (مع باريتو) ----------------
    switchAnalyticsMode(mode) {
        if (mode === 'factory' && !this.currentUser?.isMaster) {
            this.showToast('تحليل المصنع متاح للمدير الرئيسي فقط', true);
            mode = 'dept';
        }
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
            // تحليلات المصنع بالكامل ضمن نطاق الأقسام المسموح بها
            const analyticsDepartments = this.visibleDepartments();
            let factoryTotalActual = 0;
            let deptProd = {};
            let deptTargets = {};
            let globalScratches = {};
            let totalScratchesCount = 0;

            analyticsDepartments.forEach(d => { deptProd[d] = {}; deptTargets[d] = 0; });

            if(this.data.master.production) {
                this.data.master.production.forEach(r => {
                    if(r.department && analyticsDepartments.includes(r.department) && r.recordId && r.recordId.startsWith(r.department)) {
                        const val = Number(r.actual) || 0;
                        const hourPrefix = r.hour.split(':')[0]; 
                        deptProd[r.department][hourPrefix] = Math.max(deptProd[r.department][hourPrefix] || 0, val);
                    }
                });
            }

            if(this.data.master.targets) {
                this.data.master.targets.forEach(r => {
                    if(r.department && analyticsDepartments.includes(r.department)) {
                        deptTargets[r.department] = Number(r.target) || 0;
                    }
                });
            }

            if(this.data.master.scratches) {
                this.data.master.scratches.forEach(r => {
                    if (!r.department || !analyticsDepartments.includes(r.department)) return;
                    globalScratches[r.type] = (globalScratches[r.type] || 0) + 1;
                    totalScratchesCount++;
                });
            }

            let finalDeptProdTotals = {};
            analyticsDepartments.forEach(d => {
                const sum = Object.values(deptProd[d]).reduce((acc, val) => acc + val, 0);
                finalDeptProdTotals[d] = sum;
                factoryTotalActual += sum;
            });

            const facProdEl = document.getElementById('analytics-fac-prod');
            const facDefectsEl = document.getElementById('analytics-fac-defects');
            if(facProdEl) facProdEl.innerText = factoryTotalActual;
            if(facDefectsEl) facDefectsEl.innerText = totalScratchesCount;

            const depts = analyticsDepartments;
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
        const visibleDepartments = this.visibleDepartments();
        const selected = select.value || this.data.currentDepartment || '';
        select.innerHTML = visibleDepartments.length
            ? visibleDepartments.map((dept) => `<option value="${this.escapeHtml(dept)}">${this.escapeHtml(dept)}</option>`).join('')
            : '<option value="">لا توجد أقسام</option>';
        if (visibleDepartments.includes(selected)) select.value = selected;
        else if (visibleDepartments.length) select.value = visibleDepartments[0];
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
        if (!this.requireEdit('fiveS')) return;
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

    blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('read_error'));
            reader.readAsDataURL(blob);
        });
    },

    get5SImageUrl(url) { return this.getImageUrl(url); },

    async upload5SImage(file, noteId, date, kind) {
        if (!file) return null;
        const blob = await this.compress5SImage(file);
        const base64 = await this.blobToDataUrl(blob);
        const imageUrl = await this.uploadToCloudinary(base64, `5S/${date}`);
        return { path: imageUrl, url: imageUrl };
    },

    async add5SCorrectiveImage(noteId, file) {
        if (!this.requireEdit('fiveS')) return;
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
        if (!this.requireEdit('fiveS')) return;
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
                updatedAtClient: new Date().toISOString(),
                createdByClientId: this.fiveSClientId
            };
            await API.fiveS.saveNote(note);
            ['5s-observation-image', '5s-corrective-image'].forEach((id) => { const input = document.getElementById(id); if (input) input.value = ''; });
            const descriptionInput = document.getElementById('5s-description');
            if (descriptionInput) descriptionInput.value = '';
            this.showToast('تم حفظ ملاحظة 5S بنجاح ✅');
        } catch (error) {
            console.error('5S upload error:', error);
            this.showToast('تعذر حفظ الملاحظة أو الصور، راجع صلاحيات التخزين', true);
        } finally {
            if (loader) loader.classList.remove('show');
            if (loaderText) loaderText.innerText = 'جاري المعالجة...';
        }
    },

    async delete5SNote(noteId) {
        if (!this.requireEdit('fiveS')) return;
        const note = (this.data.fiveS.notes || []).find((item) => item.id === noteId);
        if (!note) { this.showToast('تعذر العثور على الملاحظة', true); return; }
        const locationLabel = [note.department, note.place].filter(Boolean).join(' · ');
        const confirmed = window.confirm(`هل تريد حذف ملاحظة 5S هذه نهائياً؟\n${locationLabel ? `المكان: ${locationLabel}\n` : ''}سيتم حذف سجل الملاحظة من النظام ولا يمكن التراجع عن ذلك.`);
        if (!confirmed) return;
        if (!this.isOnline) { this.showToast('لا يوجد اتصال بالسحابة حالياً', true); return; }
        try {
            await API.fiveS.deleteNote(noteId);
            this.showToast('تم حذف ملاحظة 5S بنجاح ✅');
        } catch (error) {
            console.error('5S delete error:', error);
            this.showToast('تعذر حذف الملاحظة. تحقق من صلاحيات Firestore', true);
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
                const observationUrl = this.escapeHtml(this.get5SImageUrl(note.observationImageUrl || ''));
                const correctiveUrl = this.escapeHtml(this.get5SImageUrl(note.correctiveImageUrl || ''));
                const noteId = this.escapeHtml(note.id || '');
                const observationHtml = observationUrl ? `<div class="s5-image-frame"><img src="${observationUrl}" onclick="App.openImage(this.src)" alt="صورة الملاحظة"><span class="s5-image-label">صورة الملاحظة</span></div>` : '<div class="s5-image-frame s5-no-image"><i class="fa-solid fa-image"></i><span>لا توجد صورة</span></div>';
                const correctiveHtml = correctiveUrl
                    ? `<div class="s5-image-frame"><img src="${correctiveUrl}" onclick="App.openImage(this.src)" alt="صورة الفعل التصحيحي"><span class="s5-image-label">الفعل التصحيحي</span></div>`
                    : this.canEdit('fiveS')
                        ? `<div class="s5-image-frame s5-no-image"><i class="fa-solid fa-hourglass-half"></i><label class="s5-corrective-upload"><input type="file" accept="image/*" onchange="App.add5SCorrectiveImage('${noteId}', this.files[0])"><span>رفع الفعل التصحيحي</span></label></div>`
                        : `<div class="s5-image-frame s5-no-image"><i class="fa-solid fa-hourglass-half"></i><span>بانتظار الفعل التصحيحي</span></div>`;
                const time = note.createdAt ? new Date(note.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '';
                const deleteHtml = this.canEdit('fiveS') ? `<button type="button" class="s5-delete-btn" onclick="App.delete5SNote('${noteId}')" title="حذف ملاحظة 5S"><i class="fa-solid fa-trash"></i><span>حذف الملاحظة</span></button>` : '';
                return `<div class="card s5-note-card"><div class="s5-note-images">${observationHtml}${correctiveHtml}</div><div class="s5-note-meta"><span><i class="fa-solid fa-clock"></i> ${this.escapeHtml(time)}</span><span class="defect-badge ${correctiveUrl ? 'fixed' : 'pending'}">${correctiveUrl ? 'تم التوثيق' : 'بانتظار الفعل التصحيحي'}</span></div><p class="s5-note-description">${this.escapeHtml(note.description)}</p><div class="s5-note-footer"><span class="s5-note-id-label">${this.escapeHtml(note.id || '')}</span>${deleteHtml}</div></div>`;
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

    async export5SReportPDF() {
        const date = document.getElementById('global-date')?.value || '';
        const notes = (this.data.fiveS.notes || []).filter((note) => note.date === date);
        if (!notes.length) { this.showToast('لا توجد ملاحظات 5S لهذا التاريخ لتصديرها', true); return; }
        if (typeof html2pdf === 'undefined') { this.showToast('مكتبة تصدير PDF غير متاحة حالياً', true); return; }

        this.showToast('جاري تجهيز تقرير 5S... يرجى الانتظار');
        const reportNotes = [...notes].sort((a, b) => {
            const locationCompare = `${a.department || ''}${a.place || ''}`.localeCompare(`${b.department || ''}${b.place || ''}`, 'ar');
            return locationCompare || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
        });
        const correctiveCount = reportNotes.filter((note) => note.correctiveImagePath || note.correctiveImageUrl).length;
        const completionRate = Math.round((correctiveCount / reportNotes.length) * 100);
        const generatedAt = new Date().toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
        const report = document.createElement('div');
        report.dir = 'rtl';
        report.className = 's5-print-report';
        report.style.cssText = 'position:relative;display:block;margin-left:-10000px;width:794px;background:#ffffff;color:#172033;padding:28px;font-family:Cairo,Arial,sans-serif;box-sizing:border-box;';

        const locationTotals = {};
        reportNotes.forEach((note) => {
            const key = `${note.department || 'غير محدد'}|||${note.place || 'غير محدد'}`;
            if (!locationTotals[key]) locationTotals[key] = { department: note.department || 'غير محدد', place: note.place || 'غير محدد', total: 0, corrective: 0 };
            locationTotals[key].total++;
            if (note.correctiveImagePath || note.correctiveImageUrl) locationTotals[key].corrective++;
        });
        const locationRows = Object.values(locationTotals).map((location) => `<tr><td>${this.escapeHtml(location.department)}</td><td>${this.escapeHtml(location.place)}</td><td>${location.total}</td><td>${location.corrective}</td></tr>`).join('');
        const imageBlock = (url, label, emptyText) => url
            ? `<div class="s5-report-image"><img src="${this.escapeHtml(url)}" crossorigin="anonymous" alt="${label}"><div class="s5-report-image-label">${label}</div></div>`
            : `<div class="s5-report-image s5-report-empty-image"><span>${emptyText}</span></div>`;
        const noteBlocks = reportNotes.map((note, index) => {
            const observationUrl = this.get5SImageUrl(note.observationImageUrl || note.observationImagePath || '');
            const correctiveUrl = this.get5SImageUrl(note.correctiveImageUrl || note.correctiveImagePath || '');
            const noteTime = note.createdAt ? new Date(note.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '';
            const status = correctiveUrl ? 'تم توثيق الفعل التصحيحي' : 'بانتظار الفعل التصحيحي';
            return `<article class="s5-report-note"><div class="s5-report-note-heading"><strong>ملاحظة ${index + 1}</strong><span>${this.escapeHtml(note.department || 'غير محدد')} · ${this.escapeHtml(note.place || 'غير محدد')} · ${this.escapeHtml(noteTime)}</span></div><div class="s5-report-images">${imageBlock(observationUrl, 'صورة الملاحظة', 'لا توجد صورة ملاحظة')}${imageBlock(correctiveUrl, 'الفعل التصحيحي', 'لم تُرفع صورة فعل تصحيحي')}</div><div class="s5-report-description"><strong>الوصف:</strong> ${this.escapeHtml(note.description || 'بدون وصف')}</div><div class="s5-report-status ${correctiveUrl ? 'done' : 'pending'}">${status}</div></article>`;
        }).join('');

        report.innerHTML = `<style>
            .s5-report-title { margin: 0 0 4px; color: #0f766e; font-size: 24px; font-weight: 800; }
            .s5-report-subtitle { margin: 0; color: #64748b; font-size: 12px; }
            .s5-report-header { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; border-bottom: 3px solid #0ab39c; padding-bottom: 14px; margin-bottom: 16px; }
            .s5-report-date { color: #334155; font-size: 13px; font-weight: 700; text-align: left; }
            .s5-report-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px; }
            .s5-report-stat { border: 1px solid #dbe4ee; border-radius: 8px; padding: 10px; text-align: center; background: #f8fafc; }
            .s5-report-stat strong { display: block; color: #0f766e; font-size: 21px; }
            .s5-report-stat span { color: #475569; font-size: 11px; font-weight: 700; }
            .s5-report-section-title { color: #172033; font-size: 15px; margin: 16px 0 8px; border-right: 4px solid #0ab39c; padding-right: 8px; }
            .s5-report-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 14px; }
            .s5-report-table th, .s5-report-table td { border: 1px solid #dbe4ee; padding: 7px 8px; text-align: right; }
            .s5-report-table th { background: #ecfeff; color: #115e59; font-weight: 800; }
            .s5-report-note { border: 1px solid #dbe4ee; border-right: 4px solid #0ab39c; border-radius: 8px; padding: 11px; margin: 0 0 12px; page-break-inside: avoid; break-inside: avoid; }
            .s5-report-note-heading { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 9px; color: #172033; font-size: 12px; }
            .s5-report-note-heading span { color: #64748b; font-size: 10px; }
            .s5-report-images { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
            .s5-report-image { position: relative; height: 210px; overflow: hidden; border-radius: 7px; background: #f1f5f9; border: 1px solid #e2e8f0; }
            .s5-report-image img { display: block; width: 100%; height: 100%; object-fit: contain; }
            .s5-report-image-label { position: absolute; right: 0; bottom: 0; left: 0; padding: 5px 7px; background: rgba(15, 23, 42, .72); color: #fff; font-size: 10px; font-weight: 800; }
            .s5-report-empty-image { display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 10px; font-weight: 700; }
            .s5-report-description { margin-top: 9px; color: #334155; font-size: 11px; line-height: 1.8; white-space: pre-wrap; }
            .s5-report-status { display: inline-block; margin-top: 8px; padding: 4px 8px; border-radius: 999px; font-size: 10px; font-weight: 800; }
            .s5-report-status.done { background: #dcfce7; color: #15803d; }
            .s5-report-status.pending { background: #fff7ed; color: #c2410c; }
            .s5-report-footer { margin-top: 16px; padding-top: 9px; border-top: 1px solid #dbe4ee; color: #64748b; font-size: 10px; }
        </style><header class="s5-report-header"><div><h1 class="s5-report-title">تقرير ملاحظات 5S</h1><p class="s5-report-subtitle">نظام الإنتاج الموحد - مجموعة العربي</p></div><div class="s5-report-date">التاريخ: ${this.escapeHtml(date)}<br>وقت التصدير: ${this.escapeHtml(generatedAt)}</div></header><div class="s5-report-summary"><div class="s5-report-stat"><strong>${reportNotes.length}</strong><span>إجمالي الملاحظات</span></div><div class="s5-report-stat"><strong>${correctiveCount}</strong><span>أفعال تصحيحية مصورة</span></div><div class="s5-report-stat"><strong>${completionRate}%</strong><span>نسبة الإغلاق</span></div></div><h2 class="s5-report-section-title">ملخص حسب المكان</h2><table class="s5-report-table"><thead><tr><th>القسم</th><th>المكان</th><th>الملاحظات</th><th>الأفعال التصحيحية</th></tr></thead><tbody>${locationRows}</tbody></table><h2 class="s5-report-section-title">تفاصيل الملاحظات والصور</h2>${noteBlocks}<div class="s5-report-footer">تم إنشاء التقرير من شاشة ملاحظات 5S. الصور محفوظة عبر Cloudinary والبيانات المعروضة تخص التاريخ المحدد.</div>`;
        document.body.appendChild(report);

        const images = [...report.querySelectorAll('img')];
        await Promise.all(images.map((image) => new Promise((resolve) => {
            let settled = false;
            const finish = () => { if (!settled) { settled = true; resolve(); } };
            image.addEventListener('load', finish, { once: true });
            image.addEventListener('error', finish, { once: true });
            if (image.complete) finish();
            setTimeout(finish, 5000);
        })));

        try {
            await html2pdf().set({
                margin: 0.35,
                filename: `5S_Report_${date || 'report'}.pdf`,
                image: { type: 'jpeg', quality: 0.95 },
                html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false },
                pagebreak: { mode: ['css', 'legacy'] },
                jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
            }).from(report).save();
            this.showToast('تم تصدير تقرير 5S بنجاح ✅');
        } catch (error) {
            console.error('5S PDF export error:', error);
            this.showToast('تعذر تصدير تقرير 5S، حاول مرة أخرى', true);
        } finally {
            report.remove();
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
    update5SNotificationButton() {
        const button = document.getElementById('5s-notification-toggle');
        if (!button) return;
        const label = button.querySelector('span');
        const supported = 'Notification' in window;
        const permission = supported ? Notification.permission : 'unsupported';
        const enabled = supported && permission === 'granted' && this.fiveSNotificationsEnabled;
        button.classList.toggle('is-enabled', enabled);
        button.classList.toggle('is-disabled', !enabled && permission !== 'default');
        button.setAttribute('aria-pressed', String(enabled));
        if (label) {
            label.textContent = !supported ? 'غير مدعومة' : enabled ? 'التنبيهات مفعلة' : permission === 'denied' ? 'الإذن مرفوض' : 'تفعيل التنبيهات';
        }
        button.title = !supported ? 'هذا المتصفح لا يدعم تنبيهات الويب' : enabled ? 'إيقاف تنبيهات ملاحظات 5S' : permission === 'denied' ? 'اسمح بالتنبيهات من إعدادات المتصفح' : 'تفعيل تنبيهات ملاحظات 5S';
    },

    async toggle5SNotifications() {
        if (!('Notification' in window)) {
            this.showToast('هذا المتصفح لا يدعم تنبيهات الويب', true);
            this.update5SNotificationButton();
            return;
        }
        const currentlyEnabled = Notification.permission === 'granted' && this.fiveSNotificationsEnabled;
        if (currentlyEnabled) {
            this.fiveSNotificationsEnabled = false;
            try { localStorage.setItem('production_system_5s_notifications', 'off'); } catch (error) { /* التخزين المحلي اختياري */ }
            this.showToast('تم إيقاف تنبيهات ملاحظات 5S');
            this.update5SNotificationButton();
            return;
        }
        if (Notification.permission === 'denied') {
            this.showToast('الإذن مرفوض من المتصفح؛ اسمح بالتنبيهات من إعداداته أولاً', true);
            this.update5SNotificationButton();
            return;
        }
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            this.showToast('لم يتم تفعيل تنبيهات ملاحظات 5S', true);
            this.update5SNotificationButton();
            return;
        }
        this.fiveSNotificationsEnabled = true;
        try { localStorage.setItem('production_system_5s_notifications', 'on'); } catch (error) { /* التخزين المحلي اختياري */ }
        this.showToast('تم تفعيل تنبيهات ملاحظات 5S ✅');
        this.update5SNotificationButton();
    },

    isPwaStandalone() {
        return Boolean(
            window.matchMedia?.('(display-mode: standalone)').matches ||
            window.navigator.standalone === true
        );
    },

    getInstallDeviceContext() {
        const userAgent = navigator.userAgent || '';
        const isIOS = /iPad|iPhone|iPod/.test(userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isAndroid = /Android/i.test(userAgent);
        return { isIOS, isAndroid };
    },

    showInstallPrompt() {
        if (this.isPwaStandalone()) return;
        try {
            if (sessionStorage.getItem('production_system_install_dismissed') === '1') return;
        } catch (error) { /* التخزين المحلي اختياري */ }

        const installBanner = document.getElementById('install-banner');
        const installButton = document.getElementById('install-now-btn');
        const installSteps = document.getElementById('install-steps');
        const browserNote = document.getElementById('install-browser-note');
        const manualButton = document.getElementById('manual-install-btn');
        if (!installBanner) return;

        const { isIOS, isAndroid } = this.getInstallDeviceContext();
        if (manualButton) manualButton.style.display = 'block';

        if (this.deferredPrompt) {
            if (installButton) installButton.innerHTML = '<i class="fa-solid fa-download"></i> تثبيت التطبيق';
            if (installSteps) {
                installSteps.style.display = 'none';
                installSteps.innerHTML = '';
            }
            if (browserNote) browserNote.textContent = 'سيظهر تأكيد التثبيت من المتصفح بعد الضغط على الزر.';
        } else if (isIOS) {
            if (installButton) installButton.innerHTML = '<i class="fa-solid fa-share-nodes"></i> عرض طريقة التثبيت';
            if (installSteps) {
                installSteps.style.display = 'block';
                installSteps.innerHTML = '<strong>طريقة التثبيت على iPhone أو iPad:</strong><br>اضغط زر المشاركة في Safari ثم اختر <strong>إضافة إلى الشاشة الرئيسية</strong> ثم اضغط إضافة.';
            }
            if (browserNote) browserNote.textContent = 'افتح الرابط في Safari لإتمام التثبيت.';
        } else {
            if (installButton) installButton.innerHTML = '<i class="fa-solid fa-download"></i> إضافة للشاشة الرئيسية';
            if (installSteps) {
                installSteps.style.display = 'block';
                installSteps.innerHTML = '<strong>إذا لم يظهر التثبيت تلقائياً:</strong><br>افتح قائمة المتصفح ⋮ ثم اختر <strong>إضافة إلى الشاشة الرئيسية</strong> أو <strong>تثبيت التطبيق</strong>.';
            }
            if (browserNote) browserNote.textContent = isAndroid ? 'يفضل استخدام Google Chrome على الهاتف.' : 'يمكن تثبيته من قائمة المتصفح إذا كان المتصفح يدعم تطبيقات PWA.';
        }
        installBanner.style.display = 'flex';
    },

    dismissInstallPrompt() {
        const installBanner = document.getElementById('install-banner');
        if (installBanner) installBanner.style.display = 'none';
        try { sessionStorage.setItem('production_system_install_dismissed', '1'); } catch (error) { /* التخزين المحلي اختياري */ }
    },

    hideInstallPrompt() {
        const installBanner = document.getElementById('install-banner');
        if (installBanner) installBanner.style.display = 'none';
    },

    waitForNativeInstallPrompt(timeoutMs = 3500) {
        if (this.deferredPrompt) return Promise.resolve(this.deferredPrompt);
        if (this.installPromptResolver) return Promise.resolve(null);
        return new Promise((resolve) => {
            let settled = false;
            const finish = (event) => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                resolve(event || null);
            };
            const timer = window.setTimeout(() => {
                if (this.installPromptResolver === finish) this.installPromptResolver = null;
                finish(null);
            }, timeoutMs);
            this.installPromptResolver = finish;
        });
    },

    async installPWA() {
        if (this.isPwaStandalone()) {
            this.hideInstallPrompt();
            return;
        }

        const nativePrompt = this.deferredPrompt || await this.waitForNativeInstallPrompt();
        if (nativePrompt) {
            try {
                nativePrompt.prompt();
                const { outcome } = await nativePrompt.userChoice;
                if (outcome === 'accepted') {
                    this.hideInstallPrompt();
                } else {
                    this.showInstallPrompt();
                }
            } catch (error) {
                console.debug('Native PWA install prompt was not available:', error);
                this.showInstallPrompt();
            } finally {
                this.deferredPrompt = null;
            }
            return;
        }

        const { isIOS } = this.getInstallDeviceContext();
        if (isIOS) {
            const installSteps = document.getElementById('install-steps');
            if (installSteps) installSteps.style.display = 'block';
            this.showToast('لم يجهز Safari نافذة تلقائية؛ اضغط مشاركة ثم إضافة إلى الشاشة الرئيسية');
        } else {
            this.showToast('لم يجهز Chrome نافذة التثبيت بعد؛ افتح الموقع من Chrome وحدّث الصفحة ثم اضغط تثبيت مرة أخرى');
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
        if (!this.currentUser?.isMaster) { this.showToast('إعادة ضبط المصنع متاحة للمدير الرئيسي فقط', true); return; }
        if(confirm("تحذير: سيتم مسح الإعدادات المحلية! هل أنت متأكد؟")) { localStorage.removeItem(CONFIG.STORAGE_KEY); location.reload(); }
    }
};

window.App = App;

function registerPwaAutoUpdate() {
    if (!('serviceWorker' in navigator)) return;

    let isReloadingForUpdate = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (isReloadingForUpdate) return;
        isReloadingForUpdate = true;
        window.location.reload();
    });

    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
        .then((registration) => {
            const checkForUpdate = () => registration.update().catch((error) => {
                console.debug('PWA update check skipped:', error);
            });
            checkForUpdate();
            window.addEventListener('focus', checkForUpdate);
            window.addEventListener('online', checkForUpdate);
            window.setInterval(checkForUpdate, 5 * 60 * 1000);
        })
        .catch((error) => console.warn('PWA auto-update unavailable:', error));
}

registerPwaAutoUpdate();
document.addEventListener('DOMContentLoaded', () => App.init());
