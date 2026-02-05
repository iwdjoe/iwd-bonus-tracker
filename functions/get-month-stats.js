// CACHE: Memory persistence across invocations
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
        const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0].replace(/-/g, '');
        const today = now.toISOString().split('T')[0].replace(/-/g, '');

        // 2. PARALLEL FETCH (Teamwork + Shared Rates)
        const [twRes, ratesRes] = await Promise.all([
            fetch(`https://iwdagency.teamwork.com/time_entries.json?page=1&pageSize=500&fromDate=${startMonth}&toDate=${today}`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } })
        ]);

        if(!twRes.ok) throw new Error("API " + twRes.status);
        const data = await twRes.json();
        
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        // 3. AGGREGATE
        let users = {};
        let projects = {};

        (data['time-entries'] || []).forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const user = e['person-first-name'] + ' ' + e['person-last-name'];
            const client = e['project-name'];
            
            if (!users[user]) users[user] = 0;
            users[user] += hours;
            
            if (!projects[client]) projects[client] = { hours: 0 };
            projects[client].hours += hours;
        });

        // 4. FORMAT
        const responseData = {
            users: Object.entries(users).map(([n, h]) => ({ name: n, hours: h })),
            projects: Object.entries(projects).map(([n, p]) => {
                const id = n.replace(/[^a-z0-9]/gi, '');
                return { id, name: n, hours: p.hours, rate: parseInt(savedRates[id] || GLOBAL_RATE), def: 155 };
            }),
            meta: { globalRate: GLOBAL_RATE, serverTime: new Date().toISOString() }
        };

        // 5. UPDATE CACHE
        cache.data = responseData;
        cache.time = Date.now();

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};