// ============================================================
// IWD Agency Expense Tracker — Main Application
// ============================================================
(function () {
    'use strict';

    // ---- Constants ----
    var ROWS_PER_PAGE = 15;
    var USER_KEY = 'iwd_expense_user';
    var OWNER_OPTIONS = ['Joe', 'Admin', 'Finance', 'Marketing', 'Operations', 'Engineering'];

    var CATEGORY_COLORS = {
        'Software & SaaS':          '#3366ff',
        'Advertising':              '#f59e0b',
        'Office Supplies':          '#8b5cf6',
        'Travel':                   '#06b6d4',
        'Meals & Entertainment':    '#f43f5e',
        'Professional Services':    '#10b981',
        'Hardware & Equipment':     '#6366f1',
        'Hosting & Infrastructure': '#0ea5e9',
        'Utilities':                '#84cc16',
        'Insurance':                '#14b8a6',
        'Payroll':                  '#ec4899',
        'Contractor Payments':      '#a855f7',
        'Marketing':                '#f97316',
        'Training & Education':     '#22d3ee',
        'Other':                    '#94a3b8',
    };

    // ---- State ----
    var expenses = [];
    var currentTab = 'all';
    var currentSort = { key: 'date', dir: 'desc' };
    var currentPage = 1;
    var editingId = null;
    var deletingId = null;
    var notesExpenseId = null;
    var csvParsedData = [];
    var csvDuplicates = [];
    var currentUser = null;
    var monthlyBudget = 0;
    var chartRange = 6;

    // Charts
    var trendChart = null;
    var categoryChart = null;
    var topExpensesChart = null;
    var ownerChart = null;

    // ---- Helpers ----
    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function fmt(n) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
    }

    function fmtDate(d) {
        if (!d) return '—';
        return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function esc(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(s));
        return d.innerHTML;
    }

    function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

    // ---- Toast ----
    function toast(message, type) {
        type = type || 'info';
        var container = document.getElementById('toastContainer');
        var colors = { success: 'bg-emerald-500', error: 'bg-red-500', warning: 'bg-amber-500', info: 'bg-iwd-500' };
        var el = document.createElement('div');
        el.className = 'flex items-center gap-2 px-4 py-3 rounded-lg text-white text-sm font-medium shadow-lg transform translate-x-full opacity-0 transition-all duration-300 ' + (colors[type] || colors.info);
        el.textContent = message;
        container.appendChild(el);
        requestAnimationFrame(function () { el.classList.remove('translate-x-full', 'opacity-0'); });
        setTimeout(function () {
            el.classList.add('translate-x-full', 'opacity-0');
            setTimeout(function () { el.remove(); }, 300);
        }, 3000);
    }

    // ---- Theme ----
    function initTheme() {
        var saved = localStorage.getItem('theme');
        if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.classList.add('dark');
        }
    }

    function toggleTheme() {
        document.documentElement.classList.toggle('dark');
        localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
        rebuildAllCharts();
    }

    document.getElementById('themeToggle').addEventListener('click', toggleTheme);

    // ---- User / Auth ----
    function getUser() {
        try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch (e) { return null; }
    }

    function setUser(name, role) {
        var user = { name: name, role: role };
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        currentUser = user;
        updateUserUI();
    }

    function updateUserUI() {
        if (!currentUser) return;
        document.getElementById('userAvatar').textContent = currentUser.name.charAt(0).toUpperCase();
        document.getElementById('userName').textContent = currentUser.name;
        document.getElementById('menuUserName').textContent = currentUser.name;
        document.getElementById('menuUserRole').textContent = cap(currentUser.role);
    }

    function showLogin() {
        document.getElementById('loginScreen').classList.remove('hidden');
    }

    function hideLogin() {
        document.getElementById('loginScreen').classList.add('hidden');
    }

    document.getElementById('loginBtn').addEventListener('click', function () {
        var name = document.getElementById('loginName').value.trim();
        if (!name) { toast('Please enter your name', 'warning'); return; }
        var role = document.getElementById('loginRole').value;
        setUser(name, role);
        hideLogin();
        initApp();
    });

    document.getElementById('loginName').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') document.getElementById('loginBtn').click();
    });

    // ---- User menu ----
    document.getElementById('userMenuBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        document.getElementById('userMenu').classList.toggle('hidden');
    });
    document.addEventListener('click', function () {
        document.getElementById('userMenu').classList.add('hidden');
    });

    document.getElementById('btnSwitchUser').addEventListener('click', function () {
        document.getElementById('userMenu').classList.add('hidden');
        document.getElementById('loginName').value = '';
        showLogin();
    });

    document.getElementById('btnDbSettings').addEventListener('click', function () {
        document.getElementById('userMenu').classList.add('hidden');
        openDBSettings();
    });

    // ---- DB Settings ----
    function openDBSettings() {
        var config = DB.getConfig();
        document.getElementById('dbUrl').value = config ? config.url : '';
        document.getElementById('dbKey').value = config ? config.key : '';
        document.getElementById('dbTestResult').classList.add('hidden');
        document.getElementById('dbDisconnectBtn').classList.toggle('hidden', DB.getMode() !== 'supabase');
        openModal('modalDB');
    }

    document.getElementById('dbBannerSetup') && document.getElementById('dbBannerSetup').addEventListener('click', openDBSettings);

    document.getElementById('dbTestBtn').addEventListener('click', async function () {
        var url = document.getElementById('dbUrl').value.trim();
        var key = document.getElementById('dbKey').value.trim();
        if (!url || !key) { toast('Enter both URL and key', 'warning'); return; }
        var res = document.getElementById('dbTestResult');
        res.classList.remove('hidden', 'bg-emerald-50', 'dark:bg-emerald-900/20', 'text-emerald-700', 'dark:text-emerald-400', 'bg-red-50', 'dark:bg-red-900/20', 'text-red-700', 'dark:text-red-400');
        res.textContent = 'Testing...';
        res.classList.add('bg-surface-50', 'dark:bg-surface-900', 'text-surface-600');
        var result = await DB.testConnection(url, key);
        res.classList.remove('bg-surface-50', 'dark:bg-surface-900', 'text-surface-600');
        if (result.ok) {
            res.textContent = result.message;
            res.classList.add('bg-emerald-50', 'dark:bg-emerald-900/20', 'text-emerald-700', 'dark:text-emerald-400');
        } else {
            res.textContent = result.message;
            res.classList.add('bg-red-50', 'dark:bg-red-900/20', 'text-red-700', 'dark:text-red-400');
        }
    });

    document.getElementById('dbSaveBtn').addEventListener('click', async function () {
        var url = document.getElementById('dbUrl').value.trim();
        var key = document.getElementById('dbKey').value.trim();
        if (!url || !key) { toast('Enter both URL and key', 'warning'); return; }
        var result = await DB.connect(url, key);
        if (result.ok) {
            toast('Database connected!', 'success');
            closeAllModals();
            updateDBBanner();
            expenses = await DB.loadAll();
            monthlyBudget = await DB.getBudget();
            render();
        } else {
            toast('Connection failed: ' + result.message, 'error');
        }
    });

    document.getElementById('dbDisconnectBtn').addEventListener('click', function () {
        DB.clearConfig();
        toast('Disconnected — using local storage', 'info');
        closeAllModals();
        updateDBBanner();
    });

    function updateDBBanner() {
        var banner = document.getElementById('dbBanner');
        banner.classList.toggle('hidden', DB.getMode() === 'supabase');
    }

    // ---- Modal helpers ----
    function openModal(id) {
        document.getElementById(id).classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    function closeAllModals() {
        document.querySelectorAll('.modal-overlay').forEach(function (m) { m.classList.add('hidden'); });
        document.body.style.overflow = '';
    }

    document.addEventListener('click', function (e) {
        if (e.target.classList.contains('modal-backdrop')) closeAllModals();
        if (e.target.closest('.modal-close')) closeAllModals();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAllModals(); });

    // ---- Filtered & sorted data ----
    function getFiltered() {
        var search = (document.getElementById('globalSearch').value || '').toLowerCase();
        var cat = document.getElementById('filterCategory').value;
        var owner = document.getElementById('filterOwner').value;
        var status = document.getElementById('filterStatus').value;
        var month = document.getElementById('filterMonth').value;

        return expenses.filter(function (e) {
            if (currentTab === 'recurring' && e.type !== 'recurring') return false;
            if (currentTab === 'one-time' && e.type !== 'one-time') return false;
            if (cat && e.category !== cat) return false;
            if (owner && e.owner !== owner) return false;
            if (status && e.status !== status) return false;
            if (month && !(e.date || '').startsWith(month)) return false;
            if (search) {
                var hay = [e.vendor, e.description, e.category, e.owner, e.notes].join(' ').toLowerCase();
                if (hay.indexOf(search) === -1) return false;
            }
            return true;
        });
    }

    function getSorted(data) {
        var key = currentSort.key;
        var dir = currentSort.dir === 'asc' ? 1 : -1;
        return data.slice().sort(function (a, b) {
            var va = a[key] || '', vb = b[key] || '';
            if (key === 'amount') { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; }
            if (va < vb) return -1 * dir;
            if (va > vb) return 1 * dir;
            return 0;
        });
    }

    // ---- KPI ----
    function renderKPI() {
        var now = new Date();
        var thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        var total = 0, recTotal = 0, oneTotal = 0, recCount = 0, oneCount = 0, monthTotal = 0;

        expenses.forEach(function (e) {
            var a = parseFloat(e.amount) || 0;
            total += a;
            if (e.type === 'recurring') { recTotal += a; recCount++; } else { oneTotal += a; oneCount++; }
            if ((e.date || '').startsWith(thisMonth)) monthTotal += a;
        });

        document.getElementById('kpiTotalExpenses').textContent = fmt(total);
        document.getElementById('kpiTotalCount').textContent = expenses.length + ' expense' + (expenses.length !== 1 ? 's' : '');
        document.getElementById('kpiRecurring').textContent = fmt(recTotal);
        document.getElementById('kpiRecurringCount').textContent = recCount + ' recurring';
        document.getElementById('kpiOneTime').textContent = fmt(oneTotal);
        document.getElementById('kpiOneTimeCount').textContent = oneCount + ' one-time';

        var budgetEl = document.getElementById('kpiBudget');
        var bar = document.getElementById('budgetBar');
        if (monthlyBudget > 0) {
            budgetEl.textContent = fmt(monthTotal) + ' / ' + fmt(monthlyBudget);
            var pct = Math.min((monthTotal / monthlyBudget) * 100, 100);
            bar.style.width = pct + '%';
            bar.className = 'h-full rounded-full transition-all duration-500 ' + (pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500');
        } else {
            budgetEl.textContent = fmt(monthTotal) + ' — click to set budget';
            bar.style.width = '0%';
        }
    }

    // ---- Owner dropdown inline ----
    function buildOwnerDropdown(expenseId, currentOwner) {
        var opts = OWNER_OPTIONS.slice();
        // Add any custom owners from data
        expenses.forEach(function (e) {
            if (e.owner && opts.indexOf(e.owner) === -1) opts.push(e.owner);
        });
        var html = '<select class="inline-owner-select text-xs rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-2 py-1 outline-none focus:ring-2 focus:ring-iwd-500 cursor-pointer" data-id="' + expenseId + '">';
        opts.forEach(function (o) {
            html += '<option' + (o === currentOwner ? ' selected' : '') + '>' + esc(o) + '</option>';
        });
        html += '</select>';
        return html;
    }

    // ---- Render Table ----
    function renderTable() {
        var filtered = getSorted(getFiltered());
        var totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
        if (currentPage > totalPages) currentPage = totalPages;
        var start = (currentPage - 1) * ROWS_PER_PAGE;
        var page = filtered.slice(start, start + ROWS_PER_PAGE);

        var tbody = document.getElementById('expenseTableBody');
        if (page.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="px-5 py-12 text-center text-surface-400"><div class="flex flex-col items-center gap-2"><svg class="h-12 w-12 text-surface-300 dark:text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg><p class="text-sm">No expenses found</p><p class="text-xs">Add an expense or import a CSV to get started</p></div></td></tr>';
        } else {
            var statusColors = { paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', overdue: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
            var typeColors = { recurring: 'bg-iwd-100 text-iwd-700 dark:bg-iwd-900/30 dark:text-iwd-400', 'one-time': 'bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-300' };

            tbody.innerHTML = page.map(function (e) {
                var nc = (e.comments && e.comments.length) || 0;
                var catColor = CATEGORY_COLORS[e.category] || '#94a3b8';

                return '<tr class="hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors">' +
                    '<td class="px-5 py-3 whitespace-nowrap text-sm">' + fmtDate(e.date) + '</td>' +
                    '<td class="px-5 py-3 whitespace-nowrap font-medium">' + esc(e.vendor) + '</td>' +
                    '<td class="px-5 py-3 max-w-[200px] truncate text-surface-600 dark:text-surface-400" title="' + esc(e.description) + '">' + esc(e.description || '—') + '</td>' +
                    '<td class="px-5 py-3 whitespace-nowrap"><span class="inline-flex items-center gap-1.5 text-xs font-medium"><span class="w-2 h-2 rounded-full flex-shrink-0" style="background:' + catColor + '"></span>' + esc(e.category) + '</span></td>' +
                    '<td class="px-5 py-3 whitespace-nowrap font-semibold">' + fmt(e.amount) + '</td>' +
                    '<td class="px-5 py-3 whitespace-nowrap"><span class="text-xs px-2 py-1 rounded-full font-medium ' + (typeColors[e.type] || typeColors['one-time']) + '">' + (e.type === 'recurring' ? 'Recurring' : 'One-Time') + '</span></td>' +
                    '<td class="px-5 py-3 whitespace-nowrap">' + buildOwnerDropdown(e.id, e.owner) + '</td>' +
                    '<td class="px-5 py-3 whitespace-nowrap"><span class="text-xs px-2 py-1 rounded-full font-medium ' + (statusColors[e.status] || statusColors.pending) + '">' + cap(e.status || 'pending') + '</span></td>' +
                    '<td class="px-5 py-3 whitespace-nowrap"><div class="flex items-center gap-1">' +
                        '<button class="action-btn p-1.5 rounded-md hover:bg-surface-100 dark:hover:bg-surface-700 transition" data-action="notes" data-id="' + e.id + '" title="Notes (' + nc + ')"><svg class="h-4 w-4 ' + (nc > 0 ? 'text-iwd-500' : 'text-surface-400') + '" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/></svg></button>' +
                        '<button class="action-btn p-1.5 rounded-md hover:bg-surface-100 dark:hover:bg-surface-700 transition" data-action="edit" data-id="' + e.id + '" title="Edit"><svg class="h-4 w-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>' +
                        '<button class="action-btn p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition" data-action="delete" data-id="' + e.id + '" title="Delete"><svg class="h-4 w-4 text-surface-400 hover:text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>' +
                    '</div></td></tr>';
            }).join('');
        }

        // Pagination info
        document.getElementById('paginationInfo').textContent = 'Showing ' + (filtered.length === 0 ? 0 : start + 1) + '–' + Math.min(start + ROWS_PER_PAGE, filtered.length) + ' of ' + filtered.length;

        // Pagination buttons
        var controls = document.getElementById('paginationControls');
        if (totalPages <= 1) { controls.innerHTML = ''; return; }
        var btns = [];
        btns.push('<button class="page-btn px-3 py-1.5 text-xs rounded-md border border-surface-200 dark:border-surface-700 ' + (currentPage === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-100 dark:hover:bg-surface-700') + '" data-page="' + (currentPage - 1) + '" ' + (currentPage === 1 ? 'disabled' : '') + '>&laquo;</button>');
        for (var i = 1; i <= totalPages; i++) {
            if (totalPages > 7 && i > 2 && i < totalPages - 1 && Math.abs(i - currentPage) > 1) {
                if (btns[btns.length - 1] !== 'dots') { btns.push('<span class="px-2 text-xs text-surface-400">...</span>'); btns.push('dots'); }
                continue;
            }
            if (btns[btns.length - 1] === 'dots') btns.pop();
            btns.push('<button class="page-btn px-3 py-1.5 text-xs rounded-md border ' + (i === currentPage ? 'bg-iwd-500 text-white border-iwd-500' : 'border-surface-200 dark:border-surface-700 hover:bg-surface-100 dark:hover:bg-surface-700') + '" data-page="' + i + '">' + i + '</button>');
        }
        btns.push('<button class="page-btn px-3 py-1.5 text-xs rounded-md border border-surface-200 dark:border-surface-700 ' + (currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-100 dark:hover:bg-surface-700') + '" data-page="' + (currentPage + 1) + '" ' + (currentPage === totalPages ? 'disabled' : '') + '>&raquo;</button>');
        if (btns[btns.length - 1] === 'dots') btns.pop();
        controls.innerHTML = btns.filter(function (b) { return b !== 'dots'; }).join('');

        // Sort arrows
        document.querySelectorAll('th[data-sort]').forEach(function (th) {
            var arrow = th.querySelector('.sort-arrow');
            arrow.textContent = th.getAttribute('data-sort') === currentSort.key ? (currentSort.dir === 'asc' ? ' \u25B2' : ' \u25BC') : '';
        });
    }

    // ---- Inline owner change ----
    document.getElementById('expenseTableBody').addEventListener('change', function (e) {
        if (!e.target.classList.contains('inline-owner-select')) return;
        var id = e.target.getAttribute('data-id');
        var newOwner = e.target.value;
        var exp = expenses.find(function (x) { return x.id === id; });
        if (exp) {
            exp.owner = newOwner;
            DB.saveExpense(exp);
            toast('Owner changed to ' + newOwner, 'success');
            renderKPI();
            renderFilters();
            rebuildAllCharts();
        }
    });

    // ---- Render Filters ----
    function renderFilters() {
        var cats = {}, owners = {};
        expenses.forEach(function (e) {
            if (e.category) cats[e.category] = true;
            if (e.owner) owners[e.owner] = true;
        });

        var catSel = document.getElementById('filterCategory');
        var cv = catSel.value;
        catSel.innerHTML = '<option value="">All Categories</option>' + Object.keys(cats).sort().map(function (c) {
            return '<option' + (c === cv ? ' selected' : '') + '>' + esc(c) + '</option>';
        }).join('');

        var ownerSel = document.getElementById('filterOwner');
        var ov = ownerSel.value;
        ownerSel.innerHTML = '<option value="">All Owners</option>' + Object.keys(owners).sort().map(function (o) {
            return '<option' + (o === ov ? ' selected' : '') + '>' + esc(o) + '</option>';
        }).join('');

        // Update owner datalist in form
        var dl = document.getElementById('ownerList');
        var allOwners = OWNER_OPTIONS.slice();
        Object.keys(owners).forEach(function (o) { if (allOwners.indexOf(o) === -1) allOwners.push(o); });
        dl.innerHTML = allOwners.map(function (o) { return '<option value="' + esc(o) + '">'; }).join('');
    }

    // ---- Charts ----
    function isDark() { return document.documentElement.classList.contains('dark'); }

    function chartTextColor() { return isDark() ? '#94a3b8' : '#64748b'; }
    function chartGridColor() { return isDark() ? 'rgba(148,163,184,0.1)' : 'rgba(0,0,0,0.06)'; }

    function tooltipStyle() {
        return {
            backgroundColor: isDark() ? '#1e293b' : '#ffffff',
            titleColor: isDark() ? '#e2e8f0' : '#1e293b',
            bodyColor: isDark() ? '#94a3b8' : '#64748b',
            borderColor: isDark() ? '#334155' : '#e2e8f0',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8,
        };
    }

    function destroyCharts() {
        if (trendChart) { trendChart.destroy(); trendChart = null; }
        if (categoryChart) { categoryChart.destroy(); categoryChart = null; }
        if (topExpensesChart) { topExpensesChart.destroy(); topExpensesChart = null; }
        if (ownerChart) { ownerChart.destroy(); ownerChart = null; }
    }

    function rebuildAllCharts() {
        destroyCharts();
        if (expenses.length === 0) return;
        buildTrendChart();
        buildCategoryChart();
        buildTopExpensesChart();
        buildOwnerChart();
    }

    function buildTrendChart() {
        var months = {}, recM = {}, oneM = {};
        expenses.forEach(function (e) {
            var m = (e.date || '').slice(0, 7);
            if (!m) return;
            var a = parseFloat(e.amount) || 0;
            months[m] = (months[m] || 0) + a;
            if (e.type === 'recurring') recM[m] = (recM[m] || 0) + a;
            else oneM[m] = (oneM[m] || 0) + a;
        });
        var labels = Object.keys(months).sort();
        if (chartRange !== 'all') labels = labels.slice(-chartRange);
        if (labels.length === 0) return;

        var displayLabels = labels.map(function (l) {
            var p = l.split('-');
            return new Date(parseInt(p[0]), parseInt(p[1]) - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        });

        var ctx = document.getElementById('trendChart');
        trendChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: displayLabels,
                datasets: [
                    { label: 'Recurring', data: labels.map(function (l) { return recM[l] || 0; }), backgroundColor: 'rgba(51,102,255,0.8)', borderRadius: 4, barPercentage: 0.6 },
                    { label: 'One-Time', data: labels.map(function (l) { return oneM[l] || 0; }), backgroundColor: 'rgba(249,115,22,0.8)', borderRadius: 4, barPercentage: 0.6 },
                    { label: 'Total', data: labels.map(function (l) { return months[l] || 0; }), type: 'line', borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', pointBackgroundColor: '#10b981', pointRadius: 4, borderWidth: 2, fill: true, tension: 0.3 },
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: chartTextColor(), usePointStyle: true, pointStyle: 'circle', padding: 16 } },
                    tooltip: Object.assign({ callbacks: { label: function (c) { return c.dataset.label + ': ' + fmt(c.raw); } } }, tooltipStyle())
                },
                scales: {
                    x: { ticks: { color: chartTextColor() }, grid: { display: false } },
                    y: { ticks: { color: chartTextColor(), callback: function (v) { return '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v); } }, grid: { color: chartGridColor() } }
                }
            }
        });
    }

    function buildCategoryChart() {
        var cats = {};
        expenses.forEach(function (e) { cats[e.category || 'Other'] = (cats[e.category || 'Other'] || 0) + (parseFloat(e.amount) || 0); });
        var sorted = Object.entries(cats).sort(function (a, b) { return b[1] - a[1]; });
        if (sorted.length === 0) return;
        var labels = sorted.map(function (s) { return s[0]; });
        var data = sorted.map(function (s) { return s[1]; });
        var bg = labels.map(function (l) { return CATEGORY_COLORS[l] || '#94a3b8'; });

        var ctx = document.getElementById('categoryChart');
        categoryChart = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: labels, datasets: [{ data: data, backgroundColor: bg, borderWidth: 0, hoverOffset: 8 }] },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '65%',
                plugins: {
                    legend: { display: false },
                    tooltip: Object.assign({ callbacks: { label: function (c) { return c.label + ': ' + fmt(c.raw); } } }, tooltipStyle())
                }
            }
        });

        var total = data.reduce(function (a, b) { return a + b; }, 0);
        document.getElementById('categoryLegend').innerHTML = sorted.slice(0, 5).map(function (s) {
            var pct = total > 0 ? ((s[1] / total) * 100).toFixed(1) : '0';
            return '<div class="flex items-center justify-between"><div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full flex-shrink-0" style="background:' + (CATEGORY_COLORS[s[0]] || '#94a3b8') + '"></span><span class="text-surface-700 dark:text-surface-300 truncate">' + esc(s[0]) + '</span></div><span class="text-surface-500 dark:text-surface-400 font-medium">' + pct + '%</span></div>';
        }).join('');
    }

    function buildTopExpensesChart() {
        var sorted = expenses.slice().sort(function (a, b) { return (parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0); }).slice(0, 5);
        if (sorted.length === 0) return;

        var ctx = document.getElementById('topExpensesChart');
        topExpensesChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: sorted.map(function (e) { return (e.vendor || '?').substring(0, 25); }),
                datasets: [{ data: sorted.map(function (e) { return parseFloat(e.amount) || 0; }), backgroundColor: sorted.map(function (e) { return CATEGORY_COLORS[e.category] || '#94a3b8'; }), borderRadius: 6, barPercentage: 0.5 }]
            },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: Object.assign({ callbacks: { label: function (c) { return fmt(c.raw); } } }, tooltipStyle()) },
                scales: {
                    x: { ticks: { color: chartTextColor(), callback: function (v) { return '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v); } }, grid: { color: chartGridColor() } },
                    y: { ticks: { color: chartTextColor() }, grid: { display: false } }
                }
            }
        });
    }

    function buildOwnerChart() {
        var owners = {};
        expenses.forEach(function (e) { owners[e.owner || 'Unassigned'] = (owners[e.owner || 'Unassigned'] || 0) + (parseFloat(e.amount) || 0); });
        var labels = Object.keys(owners).sort(function (a, b) { return owners[b] - owners[a]; });
        if (labels.length === 0) return;
        var data = labels.map(function (l) { return owners[l]; });
        var palette = ['#3366ff', '#f97316', '#10b981', '#8b5cf6', '#f43f5e', '#06b6d4', '#ec4899', '#84cc16'];

        var ctx = document.getElementById('ownerChart');
        ownerChart = new Chart(ctx, {
            type: 'bar',
            data: { labels: labels, datasets: [{ data: data, backgroundColor: labels.map(function (_, i) { return palette[i % palette.length]; }), borderRadius: 6, barPercentage: 0.5 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: Object.assign({ callbacks: { label: function (c) { return fmt(c.raw); } } }, tooltipStyle()) },
                scales: {
                    x: { ticks: { color: chartTextColor() }, grid: { display: false } },
                    y: { ticks: { color: chartTextColor(), callback: function (v) { return '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v); } }, grid: { color: chartGridColor() } }
                }
            }
        });
    }

    // ---- Full render ----
    function render() {
        renderKPI();
        renderTable();
        renderFilters();
        rebuildAllCharts();
    }

    // ---- Add/Edit Expense ----
    document.getElementById('btnAddExpense').addEventListener('click', function () {
        editingId = null;
        document.getElementById('modalExpenseTitle').textContent = 'Add New Expense';
        document.getElementById('expenseForm').reset();
        document.getElementById('expDate').value = new Date().toISOString().slice(0, 10);
        document.getElementById('recurringFields').classList.add('hidden');
        openModal('modalExpense');
    });

    document.getElementById('expType').addEventListener('change', function () {
        document.getElementById('recurringFields').classList.toggle('hidden', this.value !== 'recurring');
    });

    document.getElementById('expenseForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        var data = {
            id: editingId || uid(),
            date: document.getElementById('expDate').value,
            amount: parseFloat(document.getElementById('expAmount').value) || 0,
            vendor: document.getElementById('expVendor').value.trim(),
            description: document.getElementById('expDescription').value.trim(),
            category: document.getElementById('expCategory').value,
            type: document.getElementById('expType').value,
            frequency: document.getElementById('expType').value === 'recurring' ? document.getElementById('expFrequency').value : null,
            next_due: document.getElementById('expType').value === 'recurring' ? document.getElementById('expNextDue').value : null,
            owner: document.getElementById('expOwner').value.trim(),
            status: document.getElementById('expStatus').value,
            notes: document.getElementById('expNotes').value.trim(),
            comments: [],
            created_by: currentUser ? currentUser.name : 'Unknown',
        };

        if (editingId) {
            var idx = expenses.findIndex(function (x) { return x.id === editingId; });
            if (idx >= 0) {
                data.comments = expenses[idx].comments || [];
                data.created_by = expenses[idx].created_by || data.created_by;
                expenses[idx] = data;
            }
            toast('Expense updated', 'success');
        } else {
            expenses.push(data);
            toast('Expense added', 'success');
        }

        await DB.saveExpense(data);
        closeAllModals();
        render();
    });

    // ---- Table actions ----
    document.getElementById('expenseTableBody').addEventListener('click', function (e) {
        var btn = e.target.closest('.action-btn');
        if (!btn) return;
        var action = btn.getAttribute('data-action');
        var id = btn.getAttribute('data-id');
        var exp = expenses.find(function (x) { return x.id === id; });
        if (!exp) return;

        if (action === 'edit') {
            editingId = id;
            document.getElementById('modalExpenseTitle').textContent = 'Edit Expense';
            document.getElementById('expDate').value = exp.date;
            document.getElementById('expAmount').value = exp.amount;
            document.getElementById('expVendor').value = exp.vendor;
            document.getElementById('expDescription').value = exp.description || '';
            document.getElementById('expCategory').value = exp.category;
            document.getElementById('expType').value = exp.type;
            document.getElementById('recurringFields').classList.toggle('hidden', exp.type !== 'recurring');
            if (exp.type === 'recurring') {
                document.getElementById('expFrequency').value = exp.frequency || 'monthly';
                document.getElementById('expNextDue').value = exp.next_due || '';
            }
            document.getElementById('expOwner').value = exp.owner;
            document.getElementById('expStatus').value = exp.status;
            document.getElementById('expNotes').value = exp.notes || '';
            openModal('modalExpense');
        } else if (action === 'delete') {
            deletingId = id;
            openModal('modalDelete');
        } else if (action === 'notes') {
            notesExpenseId = id;
            document.getElementById('notesExpenseLabel').textContent = exp.vendor + ' — ' + fmt(exp.amount);
            renderNotes(exp);
            openModal('modalNotes');
        }
    });

    // ---- Delete ----
    document.getElementById('confirmDeleteBtn').addEventListener('click', async function () {
        await DB.deleteExpense(deletingId);
        expenses = expenses.filter(function (x) { return x.id !== deletingId; });
        closeAllModals();
        toast('Expense deleted', 'success');
        render();
    });

    // ---- Notes / Comments ----
    function renderNotes(exp) {
        var list = document.getElementById('notesList');
        var comments = exp.comments || [];
        var html = '';

        if (exp.notes) {
            html += '<div class="p-3 rounded-lg bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700">' +
                '<p class="text-xs font-medium text-surface-500 mb-1">Initial Note</p>' +
                '<p class="text-sm">' + esc(exp.notes) + '</p></div>';
        }

        if (comments.length === 0 && !exp.notes) {
            html = '<p class="text-sm text-surface-400 text-center py-4">No comments yet</p>';
        } else {
            html += comments.map(function (c) {
                var initial = (c.author || '?').charAt(0).toUpperCase();
                return '<div class="p-3 rounded-lg bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700">' +
                    '<div class="flex items-center gap-2 mb-1">' +
                        '<span class="w-6 h-6 rounded-full bg-iwd-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">' + initial + '</span>' +
                        '<span class="text-xs font-semibold text-surface-800 dark:text-surface-200">' + esc(c.author) + '</span>' +
                        '<span class="text-xs text-surface-400 ml-auto">' + new Date(c.timestamp).toLocaleString() + '</span>' +
                    '</div>' +
                    '<p class="text-sm pl-8">' + esc(c.text) + '</p></div>';
            }).join('');
        }

        list.innerHTML = html;
        list.scrollTop = list.scrollHeight;
    }

    document.getElementById('noteAddBtn').addEventListener('click', async function () {
        var input = document.getElementById('noteInput');
        var text = input.value.trim();
        if (!text) return;
        var exp = expenses.find(function (x) { return x.id === notesExpenseId; });
        if (!exp) return;
        if (!exp.comments) exp.comments = [];
        exp.comments.push({
            text: text,
            author: currentUser ? currentUser.name : 'Unknown',
            timestamp: new Date().toISOString()
        });
        await DB.saveExpense(exp);
        input.value = '';
        renderNotes(exp);
        renderTable();
        toast('Comment added', 'success');
    });

    document.getElementById('noteInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') document.getElementById('noteAddBtn').click();
    });

    // ---- CSV Import ----
    document.getElementById('btnImportCSV').addEventListener('click', function () {
        csvParsedData = []; csvDuplicates = [];
        document.getElementById('csvPreview').classList.add('hidden');
        document.getElementById('csvDuplicateWarning').classList.add('hidden');
        document.getElementById('csvImportBtn').disabled = true;
        document.getElementById('csvImportCount').textContent = '';
        document.getElementById('csvFileInput').value = '';
        openModal('modalCSV');
    });

    var dropZone = document.getElementById('csvDropZone');
    dropZone.addEventListener('click', function () { document.getElementById('csvFileInput').click(); });
    dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.classList.add('border-iwd-400'); });
    dropZone.addEventListener('dragleave', function () { dropZone.classList.remove('border-iwd-400'); });
    dropZone.addEventListener('drop', function (e) { e.preventDefault(); dropZone.classList.remove('border-iwd-400'); if (e.dataTransfer.files.length) parseCSV(e.dataTransfer.files[0]); });
    document.getElementById('csvFileInput').addEventListener('change', function (e) { if (e.target.files.length) parseCSV(e.target.files[0]); });

    function parseCSV(file) {
        if (!file.name.toLowerCase().endsWith('.csv')) { toast('Please upload a CSV file', 'error'); return; }
        Papa.parse(file, {
            header: true, skipEmptyLines: true,
            transformHeader: function (h) { return h.trim(); },
            complete: function (res) {
                if (res.errors.length) { toast('CSV error: ' + res.errors[0].message, 'error'); return; }
                processCSV(res.data);
            }
        });
    }

    function processCSV(data) {
        csvParsedData = data.map(function (row) {
            var n = {};
            Object.keys(row).forEach(function (k) { n[k.toLowerCase().trim()] = (row[k] || '').trim(); });
            return {
                date: n.date || '', vendor: n.vendor || n.payee || n.name || '',
                description: n.description || n.memo || n.details || '',
                category: n.category || 'Other',
                amount: parseFloat((n.amount || '0').replace(/[$,]/g, '')) || 0,
                type: (n.type || '').toLowerCase() === 'recurring' ? 'recurring' : 'one-time',
                owner: n.owner || n.assignee || '', status: (n.status || 'pending').toLowerCase(),
            };
        }).filter(function (r) { return r.vendor && r.amount; });

        csvDuplicates = [];
        csvParsedData.forEach(function (row, i) {
            var dup = expenses.some(function (e) {
                return e.date === row.date && e.vendor === row.vendor && parseFloat(e.amount) === row.amount;
            });
            if (dup) csvDuplicates.push(i);
        });

        document.getElementById('csvPreview').classList.remove('hidden');
        if (csvDuplicates.length > 0) {
            document.getElementById('csvDuplicateWarning').classList.remove('hidden');
            document.getElementById('csvDuplicateCount').textContent = csvDuplicates.length + ' duplicate' + (csvDuplicates.length > 1 ? 's' : '') + ' detected';
        }

        document.getElementById('csvPreviewHead').innerHTML = '<th class="px-3 py-2 text-left text-xs font-medium">Date</th><th class="px-3 py-2 text-left text-xs font-medium">Vendor</th><th class="px-3 py-2 text-left text-xs font-medium">Category</th><th class="px-3 py-2 text-right text-xs font-medium">Amount</th><th class="px-3 py-2 text-center text-xs font-medium">Status</th>';
        document.getElementById('csvPreviewBody').innerHTML = csvParsedData.slice(0, 20).map(function (r, i) {
            var dc = csvDuplicates.indexOf(i) >= 0;
            return '<tr class="' + (dc ? 'bg-amber-50 dark:bg-amber-900/20' : '') + '">' +
                '<td class="px-3 py-1.5">' + esc(r.date) + '</td><td class="px-3 py-1.5">' + esc(r.vendor) + '</td><td class="px-3 py-1.5">' + esc(r.category) + '</td><td class="px-3 py-1.5 text-right font-medium">' + fmt(r.amount) + '</td><td class="px-3 py-1.5 text-center">' +
                (dc ? '<span class="text-amber-500 text-xs font-medium">Duplicate</span>' : '<span class="text-emerald-500 text-xs font-medium">New</span>') + '</td></tr>';
        }).join('');

        var newCount = csvParsedData.length - csvDuplicates.length;
        document.getElementById('csvImportBtn').disabled = newCount === 0;
        document.getElementById('csvImportCount').textContent = '(' + newCount + ' new)';
    }

    document.getElementById('csvImportBtn').addEventListener('click', async function () {
        var newExpenses = [];
        csvParsedData.forEach(function (row, i) {
            if (csvDuplicates.indexOf(i) >= 0) return;
            var exp = {
                id: uid(), date: row.date, amount: row.amount, vendor: row.vendor,
                description: row.description, category: row.category, type: row.type,
                owner: row.owner, status: row.status, notes: '', comments: [],
                created_by: currentUser ? currentUser.name : 'Unknown',
            };
            expenses.push(exp);
            newExpenses.push(exp);
        });
        await DB.saveBulk(newExpenses);
        closeAllModals();
        toast(newExpenses.length + ' expense' + (newExpenses.length !== 1 ? 's' : '') + ' imported', 'success');
        render();
    });

    // ---- QuickBooks ----
    document.getElementById('btnQuickBooks').addEventListener('click', function () {
        var connected = localStorage.getItem('iwd_qb_connected') === 'true';
        document.getElementById('qbStatus').classList.toggle('hidden', connected);
        document.getElementById('qbSyncPanel').classList.toggle('hidden', !connected);
        if (connected) document.getElementById('qbLastSync').textContent = localStorage.getItem('iwd_qb_last_sync') || 'Never';
        openModal('modalQB');
    });

    document.getElementById('qbConnectBtn').addEventListener('click', function () {
        localStorage.setItem('iwd_qb_connected', 'true');
        document.getElementById('qbStatus').classList.add('hidden');
        document.getElementById('qbSyncPanel').classList.remove('hidden');
        toast('QuickBooks connected', 'success');
    });

    document.getElementById('qbSyncBtn').addEventListener('click', function () {
        var btn = this;
        btn.disabled = true;
        btn.innerHTML = '<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Syncing...';

        setTimeout(async function () {
            var samples = [
                { vendor: 'Adobe Creative Cloud', category: 'Software & SaaS', amount: 599.88, type: 'recurring', frequency: 'annually', owner: 'Marketing', description: 'Creative Suite annual license' },
                { vendor: 'Amazon Web Services', category: 'Hosting & Infrastructure', amount: 2340.50, type: 'recurring', frequency: 'monthly', owner: 'Engineering', description: 'Cloud hosting and services' },
                { vendor: 'Google Workspace', category: 'Software & SaaS', amount: 144.00, type: 'recurring', frequency: 'monthly', owner: 'Admin', description: 'Business email and productivity' },
                { vendor: 'WeWork', category: 'Utilities', amount: 3500.00, type: 'recurring', frequency: 'monthly', owner: 'Operations', description: 'Office space rental' },
                { vendor: 'Slack', category: 'Software & SaaS', amount: 87.50, type: 'recurring', frequency: 'monthly', owner: 'Admin', description: 'Team communication' },
            ];

            var imported = 0;
            var newExps = [];
            samples.forEach(function (qb) {
                var dup = expenses.some(function (e) { return e.vendor === qb.vendor && parseFloat(e.amount) === qb.amount; });
                if (!dup) {
                    var exp = {
                        id: uid(), date: new Date().toISOString().slice(0, 10), amount: qb.amount,
                        vendor: qb.vendor, description: qb.description, category: qb.category,
                        type: qb.type, frequency: qb.frequency, owner: qb.owner, status: 'paid',
                        notes: 'Synced from QuickBooks', comments: [],
                        created_by: 'QuickBooks',
                    };
                    expenses.push(exp);
                    newExps.push(exp);
                    imported++;
                }
            });

            if (newExps.length) await DB.saveBulk(newExps);
            var syncTime = new Date().toLocaleString();
            localStorage.setItem('iwd_qb_last_sync', syncTime);
            document.getElementById('qbLastSync').textContent = syncTime;

            btn.disabled = false;
            btn.innerHTML = '<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Sync Now';
            toast(imported > 0 ? imported + ' expense' + (imported > 1 ? 's' : '') + ' synced from QuickBooks' : 'Already up to date', imported > 0 ? 'success' : 'info');
            render();
        }, 2000);
    });

    document.getElementById('qbDisconnect').addEventListener('click', function () {
        localStorage.removeItem('iwd_qb_connected');
        localStorage.removeItem('iwd_qb_last_sync');
        document.getElementById('qbStatus').classList.remove('hidden');
        document.getElementById('qbSyncPanel').classList.add('hidden');
        toast('QuickBooks disconnected', 'warning');
    });

    // ---- Budget ----
    document.getElementById('budgetCard').addEventListener('click', function () {
        document.getElementById('budgetInput').value = monthlyBudget || '';
        openModal('modalBudget');
    });

    document.getElementById('saveBudgetBtn').addEventListener('click', async function () {
        monthlyBudget = parseFloat(document.getElementById('budgetInput').value) || 0;
        await DB.setBudget(monthlyBudget);
        closeAllModals();
        toast('Budget set to ' + fmt(monthlyBudget), 'success');
        renderKPI();
    });

    // ---- Export ----
    document.getElementById('btnExportCSV').addEventListener('click', function () {
        if (!expenses.length) { toast('No expenses to export', 'warning'); return; }
        var filtered = getSorted(getFiltered());
        var headers = ['Date', 'Vendor', 'Description', 'Category', 'Amount', 'Type', 'Frequency', 'Owner', 'Status', 'Notes'];
        var csv = [headers.join(',')];
        filtered.forEach(function (e) {
            csv.push([e.date, '"' + (e.vendor || '').replace(/"/g, '""') + '"', '"' + (e.description || '').replace(/"/g, '""') + '"', e.category, e.amount, e.type, e.frequency || '', e.owner, e.status, '"' + (e.notes || '').replace(/"/g, '""') + '"'].join(','));
        });
        var blob = new Blob([csv.join('\n')], { type: 'text/csv' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'iwd-expenses-' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('CSV exported', 'success');
    });

    // ---- Sorting ----
    document.querySelectorAll('th[data-sort]').forEach(function (th) {
        th.addEventListener('click', function () {
            var key = th.getAttribute('data-sort');
            if (currentSort.key === key) currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
            else currentSort = { key: key, dir: 'asc' };
            currentPage = 1;
            renderTable();
        });
    });

    // ---- Tabs ----
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            currentTab = btn.getAttribute('data-tab');
            currentPage = 1;
            renderTable();
        });
    });

    // ---- Filters ----
    ['filterCategory', 'filterOwner', 'filterStatus', 'filterMonth'].forEach(function (id) {
        document.getElementById(id).addEventListener('change', function () { currentPage = 1; renderTable(); });
    });

    // ---- Search ----
    var searchTimer;
    document.getElementById('globalSearch').addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { currentPage = 1; renderTable(); }, 250);
    });

    // ---- Pagination ----
    document.getElementById('paginationControls').addEventListener('click', function (e) {
        var btn = e.target.closest('.page-btn');
        if (!btn || btn.disabled) return;
        currentPage = parseInt(btn.getAttribute('data-page'));
        renderTable();
    });

    // ---- Chart range ----
    document.querySelectorAll('.chart-range-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.chart-range-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            chartRange = btn.getAttribute('data-range') === 'all' ? 'all' : parseInt(btn.getAttribute('data-range'));
            if (trendChart) { trendChart.destroy(); trendChart = null; }
            buildTrendChart();
        });
    });

    // ---- Seed sample data ----
    function seedSample() {
        if (expenses.length > 0) return;
        var samples = [
            { date: '2026-02-01', vendor: 'Adobe Creative Cloud', description: 'Creative Suite team license (5 seats)', category: 'Software & SaaS', amount: 274.95, type: 'recurring', frequency: 'monthly', owner: 'Marketing', status: 'paid' },
            { date: '2026-02-01', vendor: 'Amazon Web Services', description: 'EC2, S3, RDS, CloudFront hosting', category: 'Hosting & Infrastructure', amount: 2847.33, type: 'recurring', frequency: 'monthly', owner: 'Engineering', status: 'paid' },
            { date: '2026-02-01', vendor: 'Google Workspace', description: 'Business email & productivity suite', category: 'Software & SaaS', amount: 168.00, type: 'recurring', frequency: 'monthly', owner: 'Admin', status: 'paid' },
            { date: '2026-02-01', vendor: 'WeWork', description: 'Shared office space downtown', category: 'Utilities', amount: 4200.00, type: 'recurring', frequency: 'monthly', owner: 'Operations', status: 'paid' },
            { date: '2026-02-01', vendor: 'Slack', description: 'Team communication pro plan', category: 'Software & SaaS', amount: 125.00, type: 'recurring', frequency: 'monthly', owner: 'Admin', status: 'paid' },
            { date: '2026-02-03', vendor: 'Figma', description: 'Design tool organization plan', category: 'Software & SaaS', amount: 75.00, type: 'recurring', frequency: 'monthly', owner: 'Marketing', status: 'paid' },
            { date: '2026-02-05', vendor: 'HubSpot', description: 'Marketing Hub Professional', category: 'Marketing', amount: 890.00, type: 'recurring', frequency: 'monthly', owner: 'Marketing', status: 'paid' },
            { date: '2026-02-05', vendor: 'Zoom', description: 'Video conferencing business plan', category: 'Software & SaaS', amount: 199.90, type: 'recurring', frequency: 'monthly', owner: 'Admin', status: 'paid' },
            { date: '2026-02-07', vendor: 'Meta Ads', description: 'Facebook & Instagram ad campaign - Q1', category: 'Advertising', amount: 3500.00, type: 'one-time', owner: 'Marketing', status: 'paid' },
            { date: '2026-02-08', vendor: 'Google Ads', description: 'Search & Display campaign - February', category: 'Advertising', amount: 2750.00, type: 'one-time', owner: 'Marketing', status: 'paid' },
            { date: '2026-02-10', vendor: 'Staples', description: 'Office supplies - printer paper, ink, pens', category: 'Office Supplies', amount: 342.18, type: 'one-time', owner: 'Operations', status: 'paid' },
            { date: '2026-02-10', vendor: 'Notion', description: 'Team workspace plan', category: 'Software & SaaS', amount: 96.00, type: 'recurring', frequency: 'monthly', owner: 'Admin', status: 'paid' },
            { date: '2026-02-12', vendor: 'American Airlines', description: 'Flight to NYC for client meeting', category: 'Travel', amount: 487.00, type: 'one-time', owner: 'Joe', status: 'paid' },
            { date: '2026-02-12', vendor: 'Marriott', description: '2 nights NYC hotel for client meeting', category: 'Travel', amount: 698.00, type: 'one-time', owner: 'Joe', status: 'paid' },
            { date: '2026-02-14', vendor: 'Vercel', description: 'Pro plan - frontend hosting', category: 'Hosting & Infrastructure', amount: 240.00, type: 'recurring', frequency: 'monthly', owner: 'Engineering', status: 'paid' },
            { date: '2026-02-15', vendor: 'Gusto', description: 'Payroll processing - February', category: 'Payroll', amount: 12450.00, type: 'recurring', frequency: 'monthly', owner: 'Finance', status: 'paid' },
            { date: '2026-02-15', vendor: 'State Farm', description: 'Business liability insurance', category: 'Insurance', amount: 425.00, type: 'recurring', frequency: 'monthly', owner: 'Finance', status: 'paid' },
            { date: '2026-02-17', vendor: 'Freelancer - Sarah K.', description: 'Contract design work - landing pages', category: 'Contractor Payments', amount: 2800.00, type: 'one-time', owner: 'Joe', status: 'pending' },
            { date: '2026-02-18', vendor: 'LinkedIn Ads', description: 'B2B lead generation campaign', category: 'Advertising', amount: 1500.00, type: 'one-time', owner: 'Marketing', status: 'pending' },
            { date: '2026-02-20', vendor: 'Apple', description: 'MacBook Pro 14" for new developer', category: 'Hardware & Equipment', amount: 2499.00, type: 'one-time', owner: 'Engineering', status: 'paid' },
            { date: '2026-02-20', vendor: 'Udemy Business', description: 'Team learning platform annual plan', category: 'Training & Education', amount: 360.00, type: 'recurring', frequency: 'annually', owner: 'Admin', status: 'paid' },
            { date: '2026-02-22', vendor: "Carrabba's Italian Grill", description: 'Client dinner - Project kickoff', category: 'Meals & Entertainment', amount: 289.47, type: 'one-time', owner: 'Joe', status: 'paid' },
            { date: '2026-02-24', vendor: 'Smith & Associates LLP', description: 'Monthly legal retainer', category: 'Professional Services', amount: 1500.00, type: 'recurring', frequency: 'monthly', owner: 'Finance', status: 'pending' },
            { date: '2026-02-25', vendor: 'Semrush', description: 'SEO analytics pro plan', category: 'Marketing', amount: 229.95, type: 'recurring', frequency: 'monthly', owner: 'Marketing', status: 'paid' },
            { date: '2026-01-02', vendor: 'Adobe Creative Cloud', description: 'Creative Suite team license (5 seats)', category: 'Software & SaaS', amount: 274.95, type: 'recurring', frequency: 'monthly', owner: 'Marketing', status: 'paid' },
            { date: '2026-01-02', vendor: 'Amazon Web Services', description: 'EC2, S3, RDS, CloudFront hosting', category: 'Hosting & Infrastructure', amount: 2655.80, type: 'recurring', frequency: 'monthly', owner: 'Engineering', status: 'paid' },
            { date: '2026-01-03', vendor: 'Google Workspace', description: 'Business email & productivity suite', category: 'Software & SaaS', amount: 168.00, type: 'recurring', frequency: 'monthly', owner: 'Admin', status: 'paid' },
            { date: '2026-01-05', vendor: 'WeWork', description: 'Shared office space downtown', category: 'Utilities', amount: 4200.00, type: 'recurring', frequency: 'monthly', owner: 'Operations', status: 'paid' },
            { date: '2026-01-10', vendor: 'Google Ads', description: 'Search campaign - January', category: 'Advertising', amount: 2200.00, type: 'one-time', owner: 'Marketing', status: 'paid' },
            { date: '2026-01-15', vendor: 'Gusto', description: 'Payroll processing - January', category: 'Payroll', amount: 12450.00, type: 'recurring', frequency: 'monthly', owner: 'Finance', status: 'paid' },
            { date: '2025-12-01', vendor: 'Adobe Creative Cloud', description: 'Creative Suite team license', category: 'Software & SaaS', amount: 274.95, type: 'recurring', frequency: 'monthly', owner: 'Marketing', status: 'paid' },
            { date: '2025-12-01', vendor: 'Amazon Web Services', description: 'EC2, S3, RDS hosting', category: 'Hosting & Infrastructure', amount: 2410.20, type: 'recurring', frequency: 'monthly', owner: 'Engineering', status: 'paid' },
            { date: '2025-12-05', vendor: 'Holiday Party Venue', description: 'Annual holiday party for team', category: 'Meals & Entertainment', amount: 3200.00, type: 'one-time', owner: 'Admin', status: 'paid' },
            { date: '2025-12-15', vendor: 'Gusto', description: 'Payroll processing - December', category: 'Payroll', amount: 12450.00, type: 'recurring', frequency: 'monthly', owner: 'Finance', status: 'paid' },
            { date: '2025-11-01', vendor: 'Amazon Web Services', description: 'EC2, S3, RDS hosting', category: 'Hosting & Infrastructure', amount: 2180.45, type: 'recurring', frequency: 'monthly', owner: 'Engineering', status: 'paid' },
            { date: '2025-11-08', vendor: 'WebSummit', description: 'Conference tickets (3 attendees)', category: 'Training & Education', amount: 2400.00, type: 'one-time', owner: 'Joe', status: 'paid' },
            { date: '2025-11-15', vendor: 'Gusto', description: 'Payroll processing - November', category: 'Payroll', amount: 12450.00, type: 'recurring', frequency: 'monthly', owner: 'Finance', status: 'paid' },
            { date: '2025-11-20', vendor: 'Meta Ads', description: 'Black Friday campaign', category: 'Advertising', amount: 5000.00, type: 'one-time', owner: 'Marketing', status: 'paid' },
            { date: '2025-10-01', vendor: 'Amazon Web Services', description: 'EC2, S3, RDS hosting', category: 'Hosting & Infrastructure', amount: 1950.30, type: 'recurring', frequency: 'monthly', owner: 'Engineering', status: 'paid' },
            { date: '2025-10-15', vendor: 'Gusto', description: 'Payroll processing - October', category: 'Payroll', amount: 12450.00, type: 'recurring', frequency: 'monthly', owner: 'Finance', status: 'paid' },
            { date: '2025-09-01', vendor: 'Amazon Web Services', description: 'EC2, S3, RDS hosting', category: 'Hosting & Infrastructure', amount: 1820.75, type: 'recurring', frequency: 'monthly', owner: 'Engineering', status: 'paid' },
            { date: '2025-09-15', vendor: 'Gusto', description: 'Payroll processing - September', category: 'Payroll', amount: 11200.00, type: 'recurring', frequency: 'monthly', owner: 'Finance', status: 'paid' },
        ];

        samples.forEach(function (s) {
            expenses.push({
                id: uid(), date: s.date, amount: s.amount, vendor: s.vendor,
                description: s.description, category: s.category, type: s.type,
                frequency: s.frequency || null, next_due: null, owner: s.owner,
                status: s.status, notes: '', comments: [], created_by: 'System',
            });
        });

        monthlyBudget = 50000;
        DB.setBudget(monthlyBudget);
        DB.saveBulk(expenses);
    }

    // ---- Init App ----
    async function initApp() {
        DB.init();
        updateDBBanner();
        expenses = await DB.loadAll();
        monthlyBudget = await DB.getBudget();
        seedSample();
        render();
    }

    // ---- Boot ----
    initTheme();
    currentUser = getUser();
    if (!currentUser) {
        showLogin();
    } else {
        updateUserUI();
        initApp();
    }

})();
