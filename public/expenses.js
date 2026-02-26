// ============================================================
// IWD Agency Expense Tracker — Main Application
// ============================================================
(function () {
    'use strict';

    // ---- Constants ----
    const STORAGE_KEY = 'iwd_expenses';
    const BUDGET_KEY = 'iwd_monthly_budget';
    const QB_KEY = 'iwd_qb_connected';
    const ROWS_PER_PAGE = 15;

    const CATEGORY_COLORS = {
        'Software & SaaS':       { bg: '#3366ff', light: '#eef4ff' },
        'Advertising':           { bg: '#f59e0b', light: '#fffbeb' },
        'Office Supplies':       { bg: '#8b5cf6', light: '#f5f3ff' },
        'Travel':                { bg: '#06b6d4', light: '#ecfeff' },
        'Meals & Entertainment': { bg: '#f43f5e', light: '#fff1f2' },
        'Professional Services': { bg: '#10b981', light: '#ecfdf5' },
        'Hardware & Equipment':  { bg: '#6366f1', light: '#eef2ff' },
        'Hosting & Infrastructure': { bg: '#0ea5e9', light: '#f0f9ff' },
        'Utilities':             { bg: '#84cc16', light: '#f7fee7' },
        'Insurance':             { bg: '#14b8a6', light: '#f0fdfa' },
        'Payroll':               { bg: '#ec4899', light: '#fdf2f8' },
        'Contractor Payments':   { bg: '#a855f7', light: '#faf5ff' },
        'Marketing':             { bg: '#f97316', light: '#fff7ed' },
        'Training & Education':  { bg: '#22d3ee', light: '#ecfeff' },
        'Other':                 { bg: '#94a3b8', light: '#f8fafc' },
    };

    // ---- State ----
    let expenses = [];
    let currentTab = 'all';
    let currentSort = { key: 'date', dir: 'desc' };
    let currentPage = 1;
    let editingId = null;
    let deletingId = null;
    let notesExpenseId = null;
    let csvParsedData = [];
    let csvDuplicates = [];

    // Chart instances
    let trendChart, categoryChart, topExpensesChart, ownerChart;

    // ---- Helpers ----
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function formatCurrency(n) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
    }

    function formatDate(d) {
        return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function save() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
    }

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            expenses = raw ? JSON.parse(raw) : [];
        } catch { expenses = []; }
    }

    function getBudget() {
        return parseFloat(localStorage.getItem(BUDGET_KEY)) || 0;
    }

    function setBudget(v) {
        localStorage.setItem(BUDGET_KEY, v.toString());
    }

    // ---- Toast Notifications ----
    function toast(message, type) {
        type = type || 'info';
        const container = document.getElementById('toastContainer');
        const colors = {
            success: 'bg-emerald-500',
            error: 'bg-red-500',
            warning: 'bg-amber-500',
            info: 'bg-iwd-500',
        };
        const el = document.createElement('div');
        el.className = 'flex items-center gap-2 px-4 py-3 rounded-lg text-white text-sm font-medium shadow-lg transform translate-x-full opacity-0 transition-all duration-300 ' + (colors[type] || colors.info);
        el.innerHTML = '<span>' + message + '</span>';
        container.appendChild(el);
        requestAnimationFrame(function () {
            el.classList.remove('translate-x-full', 'opacity-0');
        });
        setTimeout(function () {
            el.classList.add('translate-x-full', 'opacity-0');
            setTimeout(function () { el.remove(); }, 300);
        }, 3000);
    }

    // ---- Theme ----
    function initTheme() {
        const saved = localStorage.getItem('theme');
        if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.classList.add('dark');
        }
    }

    // Make toggleTheme global for nav.js
    window.toggleTheme = function () {
        document.documentElement.classList.toggle('dark');
        localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
        rebuildCharts();
    };

    document.getElementById('themeToggle').addEventListener('click', function () {
        window.toggleTheme();
    });

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
            if (month && !e.date.startsWith(month)) return false;
            if (search) {
                var haystack = [e.vendor, e.description, e.category, e.owner, e.notes].join(' ').toLowerCase();
                if (haystack.indexOf(search) === -1) return false;
            }
            return true;
        });
    }

    function getSorted(data) {
        var key = currentSort.key;
        var dir = currentSort.dir === 'asc' ? 1 : -1;
        return data.slice().sort(function (a, b) {
            var va = a[key] || '';
            var vb = b[key] || '';
            if (key === 'amount') { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; }
            if (key === 'date') { va = va.toString(); vb = vb.toString(); }
            if (va < vb) return -1 * dir;
            if (va > vb) return 1 * dir;
            return 0;
        });
    }

    // ---- Render KPI Cards ----
    function renderKPI() {
        var now = new Date();
        var thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        var total = 0, recTotal = 0, oneTotal = 0, recCount = 0, oneCount = 0, monthTotal = 0;

        expenses.forEach(function (e) {
            var amt = parseFloat(e.amount) || 0;
            total += amt;
            if (e.type === 'recurring') { recTotal += amt; recCount++; }
            else { oneTotal += amt; oneCount++; }
            if (e.date && e.date.startsWith(thisMonth)) monthTotal += amt;
        });

        document.getElementById('kpiTotalExpenses').textContent = formatCurrency(total);
        document.getElementById('kpiTotalCount').textContent = expenses.length + ' expense' + (expenses.length !== 1 ? 's' : '');
        document.getElementById('kpiRecurring').textContent = formatCurrency(recTotal);
        document.getElementById('kpiRecurringCount').textContent = recCount + ' recurring';
        document.getElementById('kpiOneTime').textContent = formatCurrency(oneTotal);
        document.getElementById('kpiOneTimeCount').textContent = oneCount + ' one-time';

        var budget = getBudget();
        var budgetEl = document.getElementById('kpiBudget');
        var bar = document.getElementById('budgetBar');
        if (budget > 0) {
            budgetEl.textContent = formatCurrency(monthTotal) + ' / ' + formatCurrency(budget);
            var pct = Math.min((monthTotal / budget) * 100, 100);
            bar.style.width = pct + '%';
            bar.className = 'h-full rounded-full transition-all duration-500 ' + (pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500');
        } else {
            budgetEl.innerHTML = formatCurrency(monthTotal) + ' <button id="setBudgetLink" class="text-xs text-iwd-500 hover:underline ml-1">Set budget</button>';
            bar.style.width = '0%';
        }

        // Re-bind set budget link
        var link = document.getElementById('setBudgetLink');
        if (link) {
            link.addEventListener('click', function () { openModal('modalBudget'); document.getElementById('budgetInput').value = getBudget() || ''; });
        }
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
            tbody.innerHTML = page.map(function (e) {
                var statusColors = { paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', overdue: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
                var typeColors = { recurring: 'bg-iwd-100 text-iwd-700 dark:bg-iwd-900/30 dark:text-iwd-400', 'one-time': 'bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-300' };
                var noteCount = (e.comments && e.comments.length) || 0;

                return '<tr class="hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors">' +
                    '<td class="px-5 py-3 whitespace-nowrap text-sm">' + formatDate(e.date) + '</td>' +
                    '<td class="px-5 py-3 whitespace-nowrap font-medium">' + escapeHtml(e.vendor) + '</td>' +
                    '<td class="px-5 py-3 max-w-xs truncate text-surface-600 dark:text-surface-400">' + escapeHtml(e.description || '—') + '</td>' +
                    '<td class="px-5 py-3 whitespace-nowrap"><span class="inline-flex items-center gap-1.5 text-xs font-medium"><span class="w-2 h-2 rounded-full" style="background:' + (CATEGORY_COLORS[e.category] ? CATEGORY_COLORS[e.category].bg : '#94a3b8') + '"></span>' + escapeHtml(e.category) + '</span></td>' +
                    '<td class="px-5 py-3 whitespace-nowrap font-semibold">' + formatCurrency(e.amount) + '</td>' +
                    '<td class="px-5 py-3 whitespace-nowrap"><span class="text-xs px-2 py-1 rounded-full font-medium ' + (typeColors[e.type] || typeColors['one-time']) + '">' + (e.type === 'recurring' ? 'Recurring' : 'One-Time') + '</span></td>' +
                    '<td class="px-5 py-3 whitespace-nowrap"><span class="inline-flex items-center gap-1.5 text-xs"><span class="w-5 h-5 rounded-full bg-iwd-100 dark:bg-iwd-900/40 text-iwd-600 dark:text-iwd-400 flex items-center justify-center font-bold text-[10px]">' + (e.owner ? e.owner.charAt(0).toUpperCase() : '?') + '</span>' + escapeHtml(e.owner || '—') + '</span></td>' +
                    '<td class="px-5 py-3 whitespace-nowrap"><span class="text-xs px-2 py-1 rounded-full font-medium ' + (statusColors[e.status] || statusColors.pending) + '">' + capitalize(e.status || 'pending') + '</span></td>' +
                    '<td class="px-5 py-3 whitespace-nowrap"><div class="flex items-center gap-1">' +
                        '<button class="action-btn p-1.5 rounded-md hover:bg-surface-100 dark:hover:bg-surface-700 transition" data-action="notes" data-id="' + e.id + '" title="Notes (' + noteCount + ')"><svg class="h-4 w-4 ' + (noteCount > 0 ? 'text-iwd-500' : 'text-surface-400') + '" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/></svg></button>' +
                        '<button class="action-btn p-1.5 rounded-md hover:bg-surface-100 dark:hover:bg-surface-700 transition" data-action="edit" data-id="' + e.id + '" title="Edit"><svg class="h-4 w-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>' +
                        '<button class="action-btn p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition" data-action="delete" data-id="' + e.id + '" title="Delete"><svg class="h-4 w-4 text-surface-400 hover:text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>' +
                    '</div></td></tr>';
            }).join('');
        }

        // Pagination
        document.getElementById('paginationInfo').textContent = 'Showing ' + (filtered.length === 0 ? 0 : start + 1) + '-' + Math.min(start + ROWS_PER_PAGE, filtered.length) + ' of ' + filtered.length;

        var controls = document.getElementById('paginationControls');
        if (totalPages <= 1) { controls.innerHTML = ''; return; }

        var btns = [];
        btns.push('<button class="page-btn px-3 py-1.5 text-xs rounded-md border border-surface-200 dark:border-surface-700 ' + (currentPage === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-100 dark:hover:bg-surface-700') + '" data-page="' + (currentPage - 1) + '" ' + (currentPage === 1 ? 'disabled' : '') + '>&laquo;</button>');
        for (var i = 1; i <= totalPages; i++) {
            if (totalPages > 7 && i > 2 && i < totalPages - 1 && Math.abs(i - currentPage) > 1) {
                if (btns[btns.length - 1] !== '...') btns.push('<span class="px-2 text-xs text-surface-400">...</span>');
                continue;
            }
            btns.push('<button class="page-btn px-3 py-1.5 text-xs rounded-md border ' + (i === currentPage ? 'bg-iwd-500 text-white border-iwd-500' : 'border-surface-200 dark:border-surface-700 hover:bg-surface-100 dark:hover:bg-surface-700') + '" data-page="' + i + '">' + i + '</button>');
        }
        btns.push('<button class="page-btn px-3 py-1.5 text-xs rounded-md border border-surface-200 dark:border-surface-700 ' + (currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-100 dark:hover:bg-surface-700') + '" data-page="' + (currentPage + 1) + '" ' + (currentPage === totalPages ? 'disabled' : '') + '>&raquo;</button>');
        controls.innerHTML = btns.join('');

        // Sort indicators
        document.querySelectorAll('th[data-sort]').forEach(function (th) {
            var arrow = th.querySelector('.sort-arrow');
            if (th.getAttribute('data-sort') === currentSort.key) {
                arrow.textContent = currentSort.dir === 'asc' ? ' \u25B2' : ' \u25BC';
            } else {
                arrow.textContent = '';
            }
        });
    }

    // ---- Render Filters ----
    function renderFilters() {
        var cats = {};
        var owners = {};
        expenses.forEach(function (e) {
            if (e.category) cats[e.category] = true;
            if (e.owner) owners[e.owner] = true;
        });

        var catSelect = document.getElementById('filterCategory');
        var currentCat = catSelect.value;
        catSelect.innerHTML = '<option value="">All Categories</option>' + Object.keys(cats).sort().map(function (c) {
            return '<option' + (c === currentCat ? ' selected' : '') + '>' + escapeHtml(c) + '</option>';
        }).join('');

        var ownerSelect = document.getElementById('filterOwner');
        var currentOwner = ownerSelect.value;
        ownerSelect.innerHTML = '<option value="">All Owners</option>' + Object.keys(owners).sort().map(function (o) {
            return '<option' + (o === currentOwner ? ' selected' : '') + '>' + escapeHtml(o) + '</option>';
        }).join('');
    }

    // ---- Charts ----
    function isDark() {
        return document.documentElement.classList.contains('dark');
    }

    function chartColors() {
        return {
            text: isDark() ? '#94a3b8' : '#64748b',
            grid: isDark() ? 'rgba(148,163,184,0.1)' : 'rgba(0,0,0,0.06)',
            bg: isDark() ? '#1e293b' : '#ffffff',
        };
    }

    function rebuildCharts() {
        if (trendChart) trendChart.destroy();
        if (categoryChart) categoryChart.destroy();
        if (topExpensesChart) topExpensesChart.destroy();
        if (ownerChart) ownerChart.destroy();
        buildTrendChart();
        buildCategoryChart();
        buildTopExpensesChart();
        buildOwnerChart();
    }

    function buildTrendChart() {
        var months = {};
        var recMonths = {};
        var oneMonths = {};
        expenses.forEach(function (e) {
            var m = e.date ? e.date.slice(0, 7) : 'Unknown';
            var amt = parseFloat(e.amount) || 0;
            months[m] = (months[m] || 0) + amt;
            if (e.type === 'recurring') recMonths[m] = (recMonths[m] || 0) + amt;
            else oneMonths[m] = (oneMonths[m] || 0) + amt;
        });
        var labels = Object.keys(months).sort();

        // Range filter
        var rangeBtn = document.querySelector('.chart-range-btn.bg-iwd-50, .chart-range-btn.dark\\:bg-iwd-900\\/30');
        var range = rangeBtn ? rangeBtn.getAttribute('data-range') : '6';
        if (range !== 'all') labels = labels.slice(-parseInt(range));

        var colors = chartColors();
        var ctx = document.getElementById('trendChart').getContext('2d');
        trendChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels.map(function (l) { var parts = l.split('-'); return new Date(parts[0], parts[1] - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }); }),
                datasets: [
                    {
                        label: 'Recurring',
                        data: labels.map(function (l) { return recMonths[l] || 0; }),
                        backgroundColor: 'rgba(51,102,255,0.8)',
                        borderRadius: 4,
                        barPercentage: 0.6,
                    },
                    {
                        label: 'One-Time',
                        data: labels.map(function (l) { return oneMonths[l] || 0; }),
                        backgroundColor: 'rgba(249,115,22,0.8)',
                        borderRadius: 4,
                        barPercentage: 0.6,
                    },
                    {
                        label: 'Total',
                        data: labels.map(function (l) { return months[l] || 0; }),
                        type: 'line',
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16,185,129,0.1)',
                        pointBackgroundColor: '#10b981',
                        pointRadius: 4,
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                    },
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: colors.text, usePointStyle: true, pointStyle: 'circle', padding: 16 } },
                    tooltip: {
                        backgroundColor: isDark() ? '#1e293b' : '#ffffff',
                        titleColor: isDark() ? '#e2e8f0' : '#1e293b',
                        bodyColor: isDark() ? '#94a3b8' : '#64748b',
                        borderColor: isDark() ? '#334155' : '#e2e8f0',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: { label: function (ctx) { return ctx.dataset.label + ': ' + formatCurrency(ctx.raw); } }
                    }
                },
                scales: {
                    x: { ticks: { color: colors.text }, grid: { display: false } },
                    y: { ticks: { color: colors.text, callback: function (v) { return '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v); } }, grid: { color: colors.grid } }
                }
            }
        });
    }

    function buildCategoryChart() {
        var cats = {};
        expenses.forEach(function (e) {
            var c = e.category || 'Other';
            cats[c] = (cats[c] || 0) + (parseFloat(e.amount) || 0);
        });
        var sorted = Object.entries(cats).sort(function (a, b) { return b[1] - a[1]; });
        var labels = sorted.map(function (s) { return s[0]; });
        var data = sorted.map(function (s) { return s[1]; });
        var bgColors = labels.map(function (l) { return CATEGORY_COLORS[l] ? CATEGORY_COLORS[l].bg : '#94a3b8'; });

        var ctx = document.getElementById('categoryChart').getContext('2d');
        categoryChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{ data: data, backgroundColor: bgColors, borderWidth: 0, hoverOffset: 8 }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: isDark() ? '#1e293b' : '#ffffff',
                        titleColor: isDark() ? '#e2e8f0' : '#1e293b',
                        bodyColor: isDark() ? '#94a3b8' : '#64748b',
                        borderColor: isDark() ? '#334155' : '#e2e8f0',
                        borderWidth: 1,
                        callbacks: { label: function (ctx) { return ctx.label + ': ' + formatCurrency(ctx.raw); } }
                    }
                }
            }
        });

        // Legend
        var total = data.reduce(function (a, b) { return a + b; }, 0);
        document.getElementById('categoryLegend').innerHTML = sorted.slice(0, 5).map(function (s) {
            var pct = total > 0 ? ((s[1] / total) * 100).toFixed(1) : 0;
            var color = CATEGORY_COLORS[s[0]] ? CATEGORY_COLORS[s[0]].bg : '#94a3b8';
            return '<div class="flex items-center justify-between"><div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full flex-shrink-0" style="background:' + color + '"></span><span class="text-surface-700 dark:text-surface-300 truncate">' + escapeHtml(s[0]) + '</span></div><span class="text-surface-500 dark:text-surface-400 font-medium">' + pct + '%</span></div>';
        }).join('');
    }

    function buildTopExpensesChart() {
        var sorted = expenses.slice().sort(function (a, b) { return (parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0); }).slice(0, 5);
        var colors = chartColors();

        var ctx = document.getElementById('topExpensesChart').getContext('2d');
        topExpensesChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: sorted.map(function (e) { return (e.vendor || 'Unknown').substring(0, 20); }),
                datasets: [{
                    data: sorted.map(function (e) { return parseFloat(e.amount) || 0; }),
                    backgroundColor: sorted.map(function (e) { return CATEGORY_COLORS[e.category] ? CATEGORY_COLORS[e.category].bg : '#94a3b8'; }),
                    borderRadius: 6,
                    barPercentage: 0.5,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: isDark() ? '#1e293b' : '#ffffff',
                        titleColor: isDark() ? '#e2e8f0' : '#1e293b',
                        bodyColor: isDark() ? '#94a3b8' : '#64748b',
                        borderColor: isDark() ? '#334155' : '#e2e8f0',
                        borderWidth: 1,
                        callbacks: { label: function (ctx) { return formatCurrency(ctx.raw); } }
                    }
                },
                scales: {
                    x: { ticks: { color: colors.text, callback: function (v) { return '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v); } }, grid: { color: colors.grid } },
                    y: { ticks: { color: colors.text }, grid: { display: false } }
                }
            }
        });
    }

    function buildOwnerChart() {
        var owners = {};
        expenses.forEach(function (e) {
            var o = e.owner || 'Unassigned';
            owners[o] = (owners[o] || 0) + (parseFloat(e.amount) || 0);
        });
        var labels = Object.keys(owners).sort(function (a, b) { return owners[b] - owners[a]; });
        var data = labels.map(function (l) { return owners[l]; });
        var palette = ['#3366ff', '#f97316', '#10b981', '#8b5cf6', '#f43f5e', '#06b6d4', '#ec4899', '#84cc16'];

        var ctx = document.getElementById('ownerChart').getContext('2d');
        var colors = chartColors();
        ownerChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: labels.map(function (_, i) { return palette[i % palette.length]; }),
                    borderRadius: 6,
                    barPercentage: 0.5,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: isDark() ? '#1e293b' : '#ffffff',
                        titleColor: isDark() ? '#e2e8f0' : '#1e293b',
                        bodyColor: isDark() ? '#94a3b8' : '#64748b',
                        borderColor: isDark() ? '#334155' : '#e2e8f0',
                        borderWidth: 1,
                        callbacks: { label: function (ctx) { return formatCurrency(ctx.raw); } }
                    }
                },
                scales: {
                    x: { ticks: { color: colors.text }, grid: { display: false } },
                    y: { ticks: { color: colors.text, callback: function (v) { return '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v); } }, grid: { color: colors.grid } }
                }
            }
        });
    }

    // ---- Full render ----
    function render() {
        renderKPI();
        renderTable();
        renderFilters();
        rebuildCharts();
    }

    // ---- Modal helpers ----
    function openModal(id) {
        document.getElementById(id).classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    function closeModal(id) {
        document.getElementById(id).classList.add('hidden');
        document.body.style.overflow = '';
    }

    function closeAllModals() {
        document.querySelectorAll('.modal-overlay').forEach(function (m) { m.classList.add('hidden'); });
        document.body.style.overflow = '';
    }

    // Close modals
    document.addEventListener('click', function (e) {
        if (e.target.classList.contains('modal-backdrop')) closeAllModals();
        if (e.target.closest('.modal-close')) closeAllModals();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeAllModals();
    });

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

    document.getElementById('expenseForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var data = {
            id: editingId || generateId(),
            date: document.getElementById('expDate').value,
            amount: parseFloat(document.getElementById('expAmount').value) || 0,
            vendor: document.getElementById('expVendor').value.trim(),
            description: document.getElementById('expDescription').value.trim(),
            category: document.getElementById('expCategory').value,
            type: document.getElementById('expType').value,
            frequency: document.getElementById('expType').value === 'recurring' ? document.getElementById('expFrequency').value : null,
            nextDue: document.getElementById('expType').value === 'recurring' ? document.getElementById('expNextDue').value : null,
            owner: document.getElementById('expOwner').value,
            status: document.getElementById('expStatus').value,
            notes: document.getElementById('expNotes').value.trim(),
            comments: [],
        };

        if (editingId) {
            var idx = expenses.findIndex(function (x) { return x.id === editingId; });
            if (idx >= 0) {
                data.comments = expenses[idx].comments || [];
                expenses[idx] = data;
            }
            toast('Expense updated', 'success');
        } else {
            expenses.push(data);
            toast('Expense added', 'success');
        }

        save();
        closeAllModals();
        render();
    });

    // ---- Edit from table ----
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
                document.getElementById('expNextDue').value = exp.nextDue || '';
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
            document.getElementById('notesExpenseLabel').textContent = exp.vendor + ' — ' + formatCurrency(exp.amount);
            renderNotes(exp);
            openModal('modalNotes');
        }
    });

    // ---- Delete ----
    document.getElementById('confirmDeleteBtn').addEventListener('click', function () {
        expenses = expenses.filter(function (x) { return x.id !== deletingId; });
        save();
        closeAllModals();
        toast('Expense deleted', 'success');
        render();
    });

    // ---- Notes ----
    function renderNotes(exp) {
        var list = document.getElementById('notesList');
        var comments = exp.comments || [];
        if (comments.length === 0) {
            list.innerHTML = '<p class="text-sm text-surface-400 text-center py-4">No comments yet</p>';
            if (exp.notes) {
                list.innerHTML = '<div class="p-3 rounded-lg bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700"><p class="text-xs font-medium text-surface-500 mb-1">Initial Note</p><p class="text-sm">' + escapeHtml(exp.notes) + '</p></div>';
            }
        } else {
            list.innerHTML = (exp.notes ? '<div class="p-3 rounded-lg bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700"><p class="text-xs font-medium text-surface-500 mb-1">Initial Note</p><p class="text-sm">' + escapeHtml(exp.notes) + '</p></div>' : '') +
                comments.map(function (c) {
                    return '<div class="p-3 rounded-lg bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700">' +
                        '<div class="flex items-center justify-between mb-1"><span class="text-xs font-medium text-iwd-500">' + escapeHtml(c.author || 'User') + '</span><span class="text-xs text-surface-400">' + new Date(c.timestamp).toLocaleString() + '</span></div>' +
                        '<p class="text-sm">' + escapeHtml(c.text) + '</p></div>';
                }).join('');
        }
    }

    document.getElementById('noteAddBtn').addEventListener('click', function () {
        var input = document.getElementById('noteInput');
        var text = input.value.trim();
        if (!text) return;

        var exp = expenses.find(function (x) { return x.id === notesExpenseId; });
        if (!exp) return;
        if (!exp.comments) exp.comments = [];
        exp.comments.push({ text: text, author: 'User', timestamp: new Date().toISOString() });
        save();
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
        csvParsedData = [];
        csvDuplicates = [];
        document.getElementById('csvPreview').classList.add('hidden');
        document.getElementById('csvDuplicateWarning').classList.add('hidden');
        document.getElementById('csvImportBtn').disabled = true;
        document.getElementById('csvImportCount').textContent = '';
        document.getElementById('csvFileInput').value = '';
        openModal('modalCSV');
    });

    // Drag and drop
    var dropZone = document.getElementById('csvDropZone');
    dropZone.addEventListener('click', function () { document.getElementById('csvFileInput').click(); });
    dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.classList.add('border-iwd-400', 'dark:border-iwd-500', 'bg-iwd-50/50', 'dark:bg-iwd-900/10'); });
    dropZone.addEventListener('dragleave', function () { dropZone.classList.remove('border-iwd-400', 'dark:border-iwd-500', 'bg-iwd-50/50', 'dark:bg-iwd-900/10'); });
    dropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        dropZone.classList.remove('border-iwd-400', 'dark:border-iwd-500', 'bg-iwd-50/50', 'dark:bg-iwd-900/10');
        if (e.dataTransfer.files.length) parseCSVFile(e.dataTransfer.files[0]);
    });
    document.getElementById('csvFileInput').addEventListener('change', function (e) {
        if (e.target.files.length) parseCSVFile(e.target.files[0]);
    });

    function parseCSVFile(file) {
        if (!file.name.toLowerCase().endsWith('.csv')) {
            toast('Please upload a CSV file', 'error');
            return;
        }
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            transformHeader: function (h) { return h.trim(); },
            complete: function (results) {
                if (results.errors.length > 0) {
                    toast('CSV parse error: ' + results.errors[0].message, 'error');
                    return;
                }
                processCSVData(results.data);
            }
        });
    }

    function processCSVData(data) {
        // Normalize columns (case-insensitive matching)
        csvParsedData = data.map(function (row) {
            var normalized = {};
            Object.keys(row).forEach(function (key) {
                normalized[key.toLowerCase().trim()] = (row[key] || '').trim();
            });
            return {
                date: normalized.date || '',
                vendor: normalized.vendor || normalized.payee || normalized.name || '',
                description: normalized.description || normalized.memo || normalized.details || '',
                category: normalized.category || normalized.type || 'Other',
                amount: parseFloat((normalized.amount || '0').replace(/[$,]/g, '')) || 0,
                type: (normalized.type || '').toLowerCase() === 'recurring' ? 'recurring' : 'one-time',
                owner: normalized.owner || normalized.assignee || '',
                status: (normalized.status || 'pending').toLowerCase(),
            };
        }).filter(function (r) { return r.vendor && r.amount; });

        // Check duplicates
        csvDuplicates = [];
        csvParsedData.forEach(function (row, i) {
            var isDup = expenses.some(function (e) {
                return e.date === row.date && e.vendor === row.vendor && parseFloat(e.amount) === row.amount;
            });
            if (isDup) csvDuplicates.push(i);
        });

        // Show preview
        document.getElementById('csvPreview').classList.remove('hidden');
        if (csvDuplicates.length > 0) {
            document.getElementById('csvDuplicateWarning').classList.remove('hidden');
            document.getElementById('csvDuplicateCount').textContent = csvDuplicates.length + ' duplicate' + (csvDuplicates.length > 1 ? 's' : '') + ' detected';
        }

        var head = document.getElementById('csvPreviewHead');
        head.innerHTML = '<th class="px-3 py-2 text-left text-xs font-medium">Date</th><th class="px-3 py-2 text-left text-xs font-medium">Vendor</th><th class="px-3 py-2 text-left text-xs font-medium">Category</th><th class="px-3 py-2 text-right text-xs font-medium">Amount</th><th class="px-3 py-2 text-left text-xs font-medium">Type</th><th class="px-3 py-2 text-center text-xs font-medium">Status</th>';

        var body = document.getElementById('csvPreviewBody');
        body.innerHTML = csvParsedData.slice(0, 20).map(function (r, i) {
            var dupClass = csvDuplicates.indexOf(i) >= 0 ? ' bg-amber-50 dark:bg-amber-900/20' : '';
            return '<tr class="' + dupClass + '">' +
                '<td class="px-3 py-1.5">' + escapeHtml(r.date) + '</td>' +
                '<td class="px-3 py-1.5">' + escapeHtml(r.vendor) + '</td>' +
                '<td class="px-3 py-1.5">' + escapeHtml(r.category) + '</td>' +
                '<td class="px-3 py-1.5 text-right font-medium">' + formatCurrency(r.amount) + '</td>' +
                '<td class="px-3 py-1.5">' + r.type + '</td>' +
                '<td class="px-3 py-1.5 text-center">' + (csvDuplicates.indexOf(i) >= 0 ? '<span class="text-amber-500 text-xs font-medium">Duplicate</span>' : '<span class="text-emerald-500 text-xs font-medium">New</span>') + '</td></tr>';
        }).join('');

        var newCount = csvParsedData.length - csvDuplicates.length;
        document.getElementById('csvImportBtn').disabled = newCount === 0;
        document.getElementById('csvImportCount').textContent = '(' + newCount + ' new)';
    }

    document.getElementById('csvImportBtn').addEventListener('click', function () {
        var imported = 0;
        csvParsedData.forEach(function (row, i) {
            if (csvDuplicates.indexOf(i) >= 0) return;
            expenses.push({
                id: generateId(),
                date: row.date,
                amount: row.amount,
                vendor: row.vendor,
                description: row.description,
                category: row.category,
                type: row.type,
                owner: row.owner,
                status: row.status,
                notes: '',
                comments: [],
            });
            imported++;
        });
        save();
        closeAllModals();
        toast(imported + ' expense' + (imported !== 1 ? 's' : '') + ' imported', 'success');
        render();
    });

    // ---- QuickBooks ----
    document.getElementById('btnQuickBooks').addEventListener('click', function () {
        var connected = localStorage.getItem(QB_KEY) === 'true';
        document.getElementById('qbStatus').classList.toggle('hidden', connected);
        document.getElementById('qbSyncPanel').classList.toggle('hidden', !connected);
        if (connected) {
            document.getElementById('qbLastSync').textContent = localStorage.getItem('iwd_qb_last_sync') || 'Never';
        }
        openModal('modalQB');
    });

    document.getElementById('qbConnectBtn').addEventListener('click', function () {
        // Simulated QB connection
        localStorage.setItem(QB_KEY, 'true');
        document.getElementById('qbStatus').classList.add('hidden');
        document.getElementById('qbSyncPanel').classList.remove('hidden');
        toast('QuickBooks connected', 'success');
    });

    document.getElementById('qbSyncBtn').addEventListener('click', function () {
        var btn = this;
        btn.disabled = true;
        btn.innerHTML = '<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Syncing...';

        // Simulate sync with sample QB data
        setTimeout(function () {
            var sampleQBExpenses = [
                { vendor: 'Adobe Creative Cloud', category: 'Software & SaaS', amount: 599.88, type: 'recurring', frequency: 'annually', owner: 'Marketing', description: 'Creative Suite annual license' },
                { vendor: 'Amazon Web Services', category: 'Hosting & Infrastructure', amount: 2340.50, type: 'recurring', frequency: 'monthly', owner: 'Engineering', description: 'Cloud hosting and services' },
                { vendor: 'Google Workspace', category: 'Software & SaaS', amount: 144.00, type: 'recurring', frequency: 'monthly', owner: 'Admin', description: 'Business email and productivity' },
                { vendor: 'WeWork', category: 'Utilities', amount: 3500.00, type: 'recurring', frequency: 'monthly', owner: 'Operations', description: 'Office space rental' },
                { vendor: 'Slack', category: 'Software & SaaS', amount: 87.50, type: 'recurring', frequency: 'monthly', owner: 'Admin', description: 'Team communication' },
            ];

            var imported = 0;
            sampleQBExpenses.forEach(function (qb) {
                var isDup = expenses.some(function (e) { return e.vendor === qb.vendor && parseFloat(e.amount) === qb.amount; });
                if (!isDup) {
                    var now = new Date();
                    expenses.push({
                        id: generateId(),
                        date: now.toISOString().slice(0, 10),
                        amount: qb.amount,
                        vendor: qb.vendor,
                        description: qb.description,
                        category: qb.category,
                        type: qb.type,
                        frequency: qb.frequency,
                        owner: qb.owner,
                        status: 'paid',
                        notes: 'Synced from QuickBooks',
                        comments: [],
                    });
                    imported++;
                }
            });

            save();
            var syncTime = new Date().toLocaleString();
            localStorage.setItem('iwd_qb_last_sync', syncTime);
            document.getElementById('qbLastSync').textContent = syncTime;

            btn.disabled = false;
            btn.innerHTML = '<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Sync Now';

            if (imported > 0) {
                toast(imported + ' expense' + (imported !== 1 ? 's' : '') + ' synced from QuickBooks', 'success');
            } else {
                toast('Already up to date', 'info');
            }
            render();
        }, 2000);
    });

    document.getElementById('qbDisconnect').addEventListener('click', function () {
        localStorage.removeItem(QB_KEY);
        localStorage.removeItem('iwd_qb_last_sync');
        document.getElementById('qbStatus').classList.remove('hidden');
        document.getElementById('qbSyncPanel').classList.add('hidden');
        toast('QuickBooks disconnected', 'warning');
    });

    // ---- Budget ----
    document.getElementById('saveBudgetBtn').addEventListener('click', function () {
        var val = parseFloat(document.getElementById('budgetInput').value) || 0;
        setBudget(val);
        closeAllModals();
        toast('Budget updated to ' + formatCurrency(val), 'success');
        render();
    });

    // Make KPI budget card clickable to edit budget
    document.querySelector('.kpi-card:last-child').addEventListener('click', function (e) {
        if (e.target.id !== 'setBudgetLink') {
            openModal('modalBudget');
            document.getElementById('budgetInput').value = getBudget() || '';
        }
    });

    // ---- Export CSV ----
    document.getElementById('btnExportCSV').addEventListener('click', function () {
        if (expenses.length === 0) { toast('No expenses to export', 'warning'); return; }
        var filtered = getSorted(getFiltered());
        var headers = ['Date', 'Vendor', 'Description', 'Category', 'Amount', 'Type', 'Frequency', 'Owner', 'Status', 'Notes'];
        var csv = [headers.join(',')];
        filtered.forEach(function (e) {
            csv.push([
                e.date,
                '"' + (e.vendor || '').replace(/"/g, '""') + '"',
                '"' + (e.description || '').replace(/"/g, '""') + '"',
                e.category,
                e.amount,
                e.type,
                e.frequency || '',
                e.owner,
                e.status,
                '"' + (e.notes || '').replace(/"/g, '""') + '"',
            ].join(','));
        });
        var blob = new Blob([csv.join('\n')], { type: 'text/csv' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'iwd-expenses-' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click();
        URL.revokeObjectURL(url);
        toast('CSV exported', 'success');
    });

    // ---- Sorting ----
    document.querySelectorAll('th[data-sort]').forEach(function (th) {
        th.addEventListener('click', function () {
            var key = th.getAttribute('data-sort');
            if (currentSort.key === key) {
                currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort = { key: key, dir: 'asc' };
            }
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

    // ---- Filter changes ----
    ['filterCategory', 'filterOwner', 'filterStatus', 'filterMonth'].forEach(function (id) {
        document.getElementById(id).addEventListener('change', function () { currentPage = 1; renderTable(); });
    });

    // ---- Search ----
    var searchTimeout;
    document.getElementById('globalSearch').addEventListener('input', function () {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(function () { currentPage = 1; renderTable(); }, 250);
    });

    // ---- Pagination ----
    document.getElementById('paginationControls').addEventListener('click', function (e) {
        var btn = e.target.closest('.page-btn');
        if (!btn || btn.disabled) return;
        currentPage = parseInt(btn.getAttribute('data-page'));
        renderTable();
    });

    // ---- Chart range buttons ----
    document.querySelectorAll('.chart-range-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.chart-range-btn').forEach(function (b) {
                b.className = 'chart-range-btn px-3 py-1 rounded-md text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700';
            });
            btn.className = 'chart-range-btn px-3 py-1 rounded-md bg-iwd-50 dark:bg-iwd-900/30 text-iwd-600 dark:text-iwd-400 font-medium';
            if (trendChart) trendChart.destroy();
            buildTrendChart();
        });
    });

    // ---- HTML escape helper ----
    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    function capitalize(s) {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    // ---- Seed sample data if empty ----
    function seedSampleData() {
        if (expenses.length > 0) return;

        var sampleExpenses = [
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
            { date: '2026-02-22', vendor: 'Carrabba\'s Italian Grill', description: 'Client dinner - Project kickoff', category: 'Meals & Entertainment', amount: 289.47, type: 'one-time', owner: 'Joe', status: 'paid' },
            { date: '2026-02-24', vendor: 'Smith & Associates LLP', description: 'Monthly legal retainer', category: 'Professional Services', amount: 1500.00, type: 'recurring', frequency: 'monthly', owner: 'Finance', status: 'pending' },
            { date: '2026-02-25', vendor: 'Semrush', description: 'SEO analytics pro plan', category: 'Marketing', amount: 229.95, type: 'recurring', frequency: 'monthly', owner: 'Marketing', status: 'paid' },
            { date: '2026-01-02', vendor: 'Adobe Creative Cloud', description: 'Creative Suite team license (5 seats)', category: 'Software & SaaS', amount: 274.95, type: 'recurring', frequency: 'monthly', owner: 'Marketing', status: 'paid' },
            { date: '2026-01-02', vendor: 'Amazon Web Services', description: 'EC2, S3, RDS, CloudFront hosting', category: 'Hosting & Infrastructure', amount: 2655.80, type: 'recurring', frequency: 'monthly', owner: 'Engineering', status: 'paid' },
            { date: '2026-01-03', vendor: 'Google Workspace', description: 'Business email & productivity suite', category: 'Software & SaaS', amount: 168.00, type: 'recurring', frequency: 'monthly', owner: 'Admin', status: 'paid' },
            { date: '2026-01-05', vendor: 'WeWork', description: 'Shared office space downtown', category: 'Utilities', amount: 4200.00, type: 'recurring', frequency: 'monthly', owner: 'Operations', status: 'paid' },
            { date: '2026-01-10', vendor: 'Google Ads', description: 'Search campaign - January', category: 'Advertising', amount: 2200.00, type: 'one-time', owner: 'Marketing', status: 'paid' },
            { date: '2026-01-15', vendor: 'Gusto', description: 'Payroll processing - January', category: 'Payroll', amount: 12450.00, type: 'recurring', frequency: 'monthly', owner: 'Finance', status: 'paid' },
            { date: '2025-12-01', vendor: 'Adobe Creative Cloud', description: 'Creative Suite team license (5 seats)', category: 'Software & SaaS', amount: 274.95, type: 'recurring', frequency: 'monthly', owner: 'Marketing', status: 'paid' },
            { date: '2025-12-01', vendor: 'Amazon Web Services', description: 'EC2, S3, RDS, CloudFront hosting', category: 'Hosting & Infrastructure', amount: 2410.20, type: 'recurring', frequency: 'monthly', owner: 'Engineering', status: 'paid' },
            { date: '2025-12-05', vendor: 'Holiday Party Venue', description: 'Annual holiday party for team', category: 'Meals & Entertainment', amount: 3200.00, type: 'one-time', owner: 'Admin', status: 'paid' },
            { date: '2025-12-10', vendor: 'Year-end Bonuses', description: 'Team performance bonuses', category: 'Payroll', amount: 8500.00, type: 'one-time', owner: 'Finance', status: 'paid' },
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

        sampleExpenses.forEach(function (e) {
            expenses.push({
                id: generateId(),
                date: e.date,
                amount: e.amount,
                vendor: e.vendor,
                description: e.description,
                category: e.category,
                type: e.type,
                frequency: e.frequency || null,
                nextDue: null,
                owner: e.owner,
                status: e.status,
                notes: '',
                comments: [],
            });
        });

        setBudget(50000);
        save();
    }

    // ---- Init ----
    initTheme();
    load();
    seedSampleData();
    render();

})();
