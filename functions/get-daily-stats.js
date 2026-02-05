// LIGHTWEIGHT DAILY FEED (Fast & Cacheable)
let cache = { data: null, time: 0 };

exports.handler = async function(event, context) {
    // 1 minute cache
    if (cache.data && (Date.now() - cache.time < 60000)) {
        return { statusCode: 200, body: JSON.stringify(cache.data) };
    }

    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');

    try {
        const now = new Date();
        const startFetch = new Date(now);
        startFetch.setDate(now.getDate() - 40); // Last 40 Days
        const fmt = (d) => d.toISOString().split('T')[0].replace(/-/g, '');

        const url = `https://iwdagency.teamwork.com/time_entries.json?page=1&pageSize=1000&fromDate=${fmt(startFetch)}&toDate=${fmt(now)}`;
        const res = await fetch(url, { headers: { 'Authorization': AUTH } });
        const data = await res.json();
        
        // AGGREGATE BY DATE
        let days = {};
        let users = {};
        let clients = {};

        (data['time-entries'] || []).forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            
            const date = e.date; // YYYY-MM-DD
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const isBillable = e['isbillable'] === '1';

            if (!days[date]) days[date] = { date, total: 0, billable: 0 };
            
            days[date].total += hours;
            if (isBillable) {
                days[date].billable += hours;
                
                // Track Top Lists (Month Only)
                // Check if date is in current month
                const isCurrentMonth = date.startsWith(now.toISOString().slice(0, 7));
                if (isCurrentMonth) {
                    const u = e['person-first-name'] + ' ' + e['person-last-name'];
                    users[u] = (users[u] || 0) + hours;
                    const c = e['project-name'];
                    clients[c] = (clients[c] || 0) + hours;
                }
            }
        });

        // Sort Top Lists
        const topUsers = Object.entries(users).sort(([,a], [,b]) => b - a).slice(0, 5).map(([n, h]) => ({ name: n, hours: h }));
        const topClients = Object.entries(clients).sort(([,a], [,b]) => b - a).slice(0, 5).map(([n, h]) => ({ name: n, hours: h }));

        // Convert Days to Sorted Array
        const timeline = Object.values(days).sort((a,b) => a.date.localeCompare(b.date));

        const response = { timeline, topUsers, topClients, meta: { serverTime: new Date().toISOString() } };
        
        cache.data = response;
        cache.time = Date.now();

        return { statusCode: 200, body: JSON.stringify(response) };

    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};