// MAIN BACKEND (Unified V49)
let cache = { data: null, time: 0 };

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";
    
    // CACHE (60s)
    if (cache.data && (Date.now() - cache.time < 60000)) {
        return { statusCode: 200, body: JSON.stringify(cache.data) };
    }

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();
        const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0].replace(/-/g, '');
        const today = now.toISOString().split('T')[0].replace(/-/g, '');

        // 1. Fetch Teamwork (This Month Only - Fast & Safe)
        const twRes = await fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${startMonth}&toDate=${today}`, { headers: { 'Authorization': AUTH } });
        if(!twRes.ok) throw new Error("Teamwork API " + twRes.status);
        const twData = await twRes.json();
        
        // 2. Fetch Rates
        const ratesRes = await fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } });
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        // 3. Process Data
        const entries = twData['time-entries'] || [];
        let users = {};
        let projects = {};
        
        // Weekly Buckets
        const startOfWeek = new Date(now);
        const day = startOfWeek.getDay() || 7; 
        if (day !== 1) startOfWeek.setHours(-24 * (day - 1)); else startOfWeek.setHours(0,0,0,0);
        const weekStr = startOfWeek.toISOString().split('T')[0];

        const weeklyStats = {
            thisWeek: { billable: 0, total: 0 },
            month: { billable: 0, total: 0, users: {}, clients: {} } // For Weekly Report Top Lists
        };

        entries.forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const user = e['person-first-name'] + ' ' + e['person-last-name'];
            const project = e['project-name'];
            const dateStr = e.date;
            const isBillable = e['isbillable'] === '1';
            
            // Main Dashboard Aggregation
            if (!users[user]) users[user] = 0;
            users[user] += hours;
            
            if (!projects[project]) projects[project] = { hours: 0 };
            projects[project].hours += hours;

            // Weekly Dashboard Aggregation
            weeklyStats.month.total += hours;
            if (isBillable) {
                weeklyStats.month.billable += hours;
                weeklyStats.month.users[user] = (weeklyStats.month.users[user] || 0) + hours;
                weeklyStats.month.clients[project] = (weeklyStats.month.clients[project] || 0) + hours;
            }

            if (dateStr >= weekStr) {
                weeklyStats.thisWeek.total += hours;
                if (isBillable) weeklyStats.thisWeek.billable += hours;
            }
        });

        // Format Main Lists
        const userList = Object.keys(users).map(name => ({ name, hours: users[name] }));
        const projectList = Object.keys(projects).map(name => {
            const id = name.replace(/[^a-z0-9]/gi, '');
            const rate = savedRates[id] || savedRates[name] || GLOBAL_RATE;
            return { id, name, hours: projects[name].hours, rate: parseInt(rate), def: GLOBAL_RATE };
        });

        // Format Weekly Top Lists
        const sortMap = (map) => Object.entries(map).sort(([,a], [,b]) => b - a).slice(0, 5).map(([name, h]) => ({ name, hours: h }));

        const responseData = {
            users: userList,
            projects: projectList,
            weekly: {
                month: { 
                    ...weeklyStats.month, 
                    topUsers: sortMap(weeklyStats.month.users), 
                    topClients: sortMap(weeklyStats.month.clients)
                },
                thisWeek: weeklyStats.thisWeek,
                lastWeek: { billable: 0, total: 0 }, // Placeholder as we aren't fetching Jan data to stay fast
                ranges: { this: `${startOfWeek.toLocaleDateString()} - Now` }
            },
            meta: { 
                serverTime: new Date().toISOString(), 
                globalRate: GLOBAL_RATE, 
                cached: false,
                globalGoal: parseInt(savedRates['__WEEKLY_GOAL__'] || 200)
            }
        };

        cache.data = { ...responseData, meta: { ...responseData.meta, cached: true } };
        cache.time = Date.now();

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};