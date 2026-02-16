// Shared navigation component — used by index.html and pulse.html
(function() {
    const page = location.pathname;
    const isBonus = page === '/' || page === '/index.html';
    const isPulse = page === '/pulse.html';

    const pages = [
        { href: '/', label: 'Bonus Tracker', icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>', active: isBonus },
        { href: '/pulse.html', label: 'Weekly Pulse', icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>', active: isPulse }
    ];

    const actions = [
        { id: 'nav-export-csv', label: 'Export CSV', icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>', bonusOnly: true },
        { id: 'nav-send-slack', label: 'Send to Slack', icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z"/></svg>', bonusOnly: true }
    ];

    function closeMenu() { document.getElementById('nav-menu').classList.add('hidden'); }

    function renderNav(container) {
        let pagesHtml = pages.map(p => {
            if (p.active) {
                return `<a href="${p.href}" class="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20">${p.icon} ${p.label}</a>`;
            }
            return `<a href="${p.href}" class="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition">${p.icon} ${p.label}</a>`;
        }).join('');

        let actionsHtml = actions.filter(a => !a.bonusOnly || isBonus).map(a =>
            `<button id="${a.id}" class="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition text-left">${a.icon} ${a.label}</button>`
        ).join('');

        const hasActions = actions.some(a => !a.bonusOnly || isBonus);

        container.innerHTML = `
            <button onclick="document.getElementById('nav-menu').classList.toggle('hidden')" class="p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition shadow-sm" title="Menu">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
            </button>
            <div id="nav-menu" class="hidden absolute right-0 mt-2 w-52 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50 py-2">
                <div class="px-4 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Pages</div>
                ${pagesHtml}
                ${hasActions ? `
                <div class="border-t border-gray-100 dark:border-gray-800 my-2"></div>
                <div class="px-4 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Actions</div>
                ${actionsHtml}` : ''}
                <button onclick="toggleTheme(); document.getElementById('nav-menu').classList.add('hidden')" class="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition text-left">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
                    <span class="dark:hidden">Dark Mode</span><span class="hidden dark:inline">Light Mode</span>
                </button>
                <div class="border-t border-gray-100 dark:border-gray-800 my-2"></div>
                <button onclick="netlifyIdentity.logout()" class="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition text-left">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                    Logout
                </button>
            </div>`;

        // Wire up action buttons after render
        if (isBonus) {
            const csvBtn = document.getElementById('nav-export-csv');
            if (csvBtn && typeof exportCSV === 'function') {
                csvBtn.addEventListener('click', function() { exportCSV(); closeMenu(); });
            }
            const slackBtn = document.getElementById('nav-send-slack');
            if (slackBtn && typeof openSlackModal === 'function') {
                slackBtn.addEventListener('click', function() { openSlackModal(); closeMenu(); });
            }
        }
    }

    // Init: find the nav container and render
    document.addEventListener('DOMContentLoaded', function() {
        const container = document.getElementById('global-nav');
        if (container) renderNav(container);
    });
})();
