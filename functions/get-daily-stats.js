// LIGHTWEIGHT DAILY FEED (V59 - Clone Main Logic)
let cache = { data: null, time: 0 };

exports.handler = async function(event, context) {
    // Disable cache for debugging this specific issue
    // if (cache.data && (Date.now() - cache.time < 60000)) ...

    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');

    try {
        const now = new Date();
        // EXACT LOGIC FROM get-stats.js (Working)
        const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0].replace(/-/g, '');
        const today = now.toISOString().split('T')[0].replace(/-/g, '');

        const url = `https://iwdagency.teamwork.com/time_entries.json?page=1&pageSize=1000&fromDate=${startMonth}&toDate=${today}`;
        
        const res = await fetch(url, { headers: { 'Authorization': AUTH } });
        const data = await res.json();
        
        const entries = data['time-entries'] || [];
        
        // AGGREGATE
        let timeline = [];
        let users = {};
        let clients = {};
        let rawCount = 0;

        entries.forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            
            rawCount++;
            let date = e.date;
            // Normalize Date just in case
            if (date.length === 8 && !date.includes('-')) date = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
            
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const isBillable = e['isbillable'] === '1';

            timeline.push({ date, hours, billable: isBill ? hours : 0 });

            if (isBillable) {
                const u = e['person-first-name'] + ' ' + e['person-last-name'];
                users[u] = (users[u] || 0) + hours;
                const c = e['project-name'];
                clients[c] = (clients[c] || 0) + hours;
            }
        });

        // Top Lists
        const topUsers = Object.entries(users).sort(([,a], [,b]) => b - a).slice(0, 5).map(([n, h]) => ({ name: n, hours: h }));
        const topClients = Object.entries(clients).sort(([,a], [,b]) => b - a).slice(0, 5).map(([n, h]) => ({ name: n, hours: h }));

        const response = { 
            timeline, 
            topUsers, 
            topClients, 
            meta: { 
                serverTime: new Date().toISOString(), 
                debugUrl: url.replace(TOKEN, 'HIDDEN'), // Show us the URL pattern
                entryCount: entries.length,
                processedCount: rawCount
            } 
        };
        
        cache.data = response;
        cache.time = Date.now();

        return { statusCode: 200, body: JSON.stringify(response) };

    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};