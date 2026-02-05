// LIGHTWEIGHT DAILY FEED (Fixed V56)
let cache = { data: null, time: 0 };

exports.handler = async function(event, context) {
    if (cache.data && (Date.now() - cache.time < 60000)) {
        return { statusCode: 200, body: JSON.stringify(cache.data) };
    }

    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');

    try {
        const now = new Date();
        const startFetch = new Date(now);
        startFetch.setDate(now.getDate() - 45); // Go back 45 days
        const fmt = (d) => d.toISOString().split('T')[0].replace(/-/g, '');

        // Fetch wide range
        const url = `https://iwdagency.teamwork.com/time_entries.json?page=1&pageSize=1000&fromDate=${fmt(startFetch)}&toDate=${fmt(now)}`;
        const res = await fetch(url, { headers: { 'Authorization': AUTH } });
        const data = await res.json();
        
        let timeline = [];
        let users = {};
        let clients = {};
        
        const entries = data['time-entries'] || [];
        const debugFirst = entries.length > 0 ? entries[0].date : "Empty";

        entries.forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            
            // Normalize Date
            let d = e.date;
            // Handle YYYYMMDD -> YYYY-MM-DD conversion if needed
            if (d.length === 8 && !d.includes('-')) d = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
            
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const isBill = e['isbillable'] === '1';

            timeline.push({ date: d, hours, billable: isBill ? hours : 0 });

            // Top Lists (Rough Approx for last 45 days)
            if (isBill) {
                const u = e['person-first-name'] + ' ' + e['person-last-name'];
                users[u] = (users[u] || 0) + hours;
                const c = e['project-name'];
                clients[c] = (clients[c] || 0) + hours;
            }
        });

        // Sort Top Lists
        const topUsers = Object.entries(users).sort(([,a], [,b]) => b - a).slice(0, 5).map(([n, h]) => ({ name: n, hours: h }));
        const topClients = Object.entries(clients).sort(([,a], [,b]) => b - a).slice(0, 5).map(([n, h]) => ({ name: n, hours: h }));

        const response = { 
            timeline, 
            topUsers, 
            topClients, 
            meta: { serverTime: new Date().toISOString(), firstDate: debugFirst } 
        };
        
        cache.data = response;
        cache.time = Date.now();

        return { statusCode: 200, body: JSON.stringify(response) };

    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};