// WEEKLY CACHE
let cache = {
    data: null,
    time: 0
};

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    
    // 1. CACHE CHECK (60s)
    if (cache.data && (Date.now() - cache.time < 60000)) {
        return { statusCode: 200, body: JSON.stringify(cache.data) };
    }

    try {
        const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const REPO = "iwdjoe/iwd-bonus-tracker";
        const GH_TOKEN = process.env.GITHUB_PAT;

        const now = new Date();
        const startFetch = new Date(now);
        startFetch.setDate(now.getDate() - 35); // Last 35 Days
        
        const fmt = (d) => d.toISOString().split('T')[0].replace(/-/g, '');

        // 2. FETCH
        const [twRes, ratesRes] = await Promise.all([
            fetch(`https://iwdagency.teamwork.com/time_entries.json?page=1&pageSize=500&fromDate=${fmt(startFetch)}&toDate=${fmt(now)}`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } })
        ]);

        if(!twRes.ok) throw new Error("API " + twRes.status);
        const data = await twRes.json();
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};

        // 3. LOGIC (Reusing robust V39 logic)
        const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfWeek = new Date(now);
        const day = startOfWeek.getDay() || 7; 
        if (day !== 1) startOfWeek.setHours(-24 * (day - 1)); else startOfWeek.setHours(0,0,0,0);
        
        const startLastWeek = new Date(startOfWeek);
        startLastWeek.setDate(startLastWeek.getDate() - 7);
        const endLastWeek = new Date(startLastWeek);
        endLastWeek.setDate(endLastWeek.getDate() + 6);

        const stats = {
            month: { billable: 0, total: 0, users: {}, clients: {} },
            thisWeek: { billable: 0, total: 0 },
            lastWeek: { billable: 0, total: 0 }
        };

        const monthStr = startMonth.toISOString().split('T')[0];
        const weekStr = startOfWeek.toISOString().split('T')[0];
        const lastStartStr = startLastWeek.toISOString().split('T')[0];
        const lastEndStr = endLastWeek.toISOString().split('T')[0];

        (data['time-entries'] || []).forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const dateStr = e.date;
            const isBillable = e['isbillable'] === '1';

            if (dateStr >= monthStr) {
                stats.month.total += hours;
                if (isBillable) {
                    stats.month.billable += hours;
                    const user = e['person-first-name'] + ' ' + e['person-last-name'];
                    stats.month.users[user] = (stats.month.users[user] || 0) + hours;
                    const client = e['project-name'];
                    stats.month.clients[client] = (stats.month.clients[client] || 0) + hours;
                }
            }

            if (dateStr >= weekStr) {
                stats.thisWeek.total += hours;
                if (isBillable) stats.thisWeek.billable += hours;
            } else if (dateStr >= lastStartStr && dateStr <= lastEndStr) {
                stats.lastWeek.total += hours;
                if (isBillable) stats.lastWeek.billable += hours;
            }
        });

        // 4. FORMAT
        const sortMap = (map) => Object.entries(map).sort(([,a], [,b]) => b - a).slice(0, 5).map(([n, h]) => ({ name, hours: h }));
        
        const responseData = {
            month: { ...stats.month, topUsers: sortMap(stats.month.users), topClients: sortMap(stats.month.clients) },
            thisWeek: stats.thisWeek,
            lastWeek: stats.lastWeek,
            meta: {
                thisWeekRange: `${startOfWeek.toLocaleDateString()} - Now`,
                lastWeekRange: `${startLastWeek.toLocaleDateString()} - ${endLastWeek.toLocaleDateString()}`,
                globalGoal: parseInt(savedRates['__WEEKLY_GOAL__'] || 200)
            }
        };

        cache.data = responseData;
        cache.time = Date.now();

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};