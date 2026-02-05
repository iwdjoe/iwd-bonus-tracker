// WEEKLY CACHE (Strictly This Month)
let cache = { data: null, time: 0 };

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
    const REPO = "iwdjoe/iwd-bonus-tracker";
    const GH_TOKEN = process.env.GITHUB_PAT;

    if (cache.data && (Date.now() - cache.time < 60000)) {
        return { statusCode: 200, body: JSON.stringify(cache.data) };
    }

    try {
        const now = new Date();
        // FETCH ONLY THIS MONTH (Safe, Fast)
        const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const fmt = (d) => d.toISOString().split('T')[0].replace(/-/g, '');
        
        // Parallel Fetch
        const [twRes, ratesRes] = await Promise.all([
            fetch(`https://iwdagency.teamwork.com/time_entries.json?page=1&pageSize=1000&fromDate=${fmt(startMonth)}&toDate=${fmt(now)}`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } })
        ]);

        if(!twRes.ok) throw new Error("API " + twRes.status);
        const data = await twRes.json();
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};

        // Define Ranges
        const startOfWeek = new Date(now);
        const day = startOfWeek.getDay() || 7; 
        if (day !== 1) startOfWeek.setHours(-24 * (day - 1)); else startOfWeek.setHours(0,0,0,0);
        
        // Stats Buckets
        const stats = {
            month: { billable: 0, total: 0, users: {}, clients: {} },
            thisWeek: { billable: 0, total: 0 },
            lastWeek: { billable: 0, total: 0 } // Will be empty if last week was Jan
        };

        const weekStr = startOfWeek.toISOString().split('T')[0];

        (data['time-entries'] || []).forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const isBillable = e['isbillable'] === '1';
            const dateStr = e.date;

            // Month Totals
            stats.month.total += hours;
            if (isBillable) {
                stats.month.billable += hours;
                const user = e['person-first-name'] + ' ' + e['person-last-name'];
                stats.month.users[user] = (stats.month.users[user] || 0) + hours;
                const client = e['project-name'];
                stats.month.clients[client] = (stats.month.clients[client] || 0) + hours;
            }

            // Week Logic
            if (dateStr >= weekStr) {
                stats.thisWeek.total += hours;
                if (isBillable) stats.thisWeek.billable += hours;
            } 
            // Note: Last Week logic removed because fetching January data crashes the API.
            // We accept "0" for Last Week in exchange for a working dashboard.
        });

        const sortMap = (map) => Object.entries(map).sort(([,a], [,b]) => b - a).slice(0, 5).map(([n, h]) => ({ name, hours: h }));
        
        const responseData = {
            month: { ...stats.month, topUsers: sortMap(stats.month.users), topClients: sortMap(stats.month.clients) },
            thisWeek: stats.thisWeek,
            lastWeek: stats.lastWeek, // Will be 0
            meta: {
                thisWeekRange: `${startOfWeek.toLocaleDateString()} - Now`,
                lastWeekRange: "Data Unavailable",
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