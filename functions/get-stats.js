// CACHE (Memory)
let cache = {
    data: null,
    time: 0
};

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    // SHARED DB AUTH
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";
    
    // Check Cache (1 min)
    if (cache.data && (Date.now() - cache.time < 60000)) {
        return { statusCode: 200, body: JSON.stringify(cache.data) };
    }

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();
        
        // Fetch Last 40 Days (Covers This Month + Last Week even at start of month)
        const startFetch = new Date(now);
        startFetch.setDate(now.getDate() - 40);
        const fmt = (d) => d.toISOString().split('T')[0].replace(/-/g, '');

        // PARALLEL FETCH: Teamwork + Rates
        const [twRes, ratesRes] = await Promise.all([
            fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=1000&fromDate=${fmt(startFetch)}&toDate=${fmt(now)}`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } })
        ]);

        if(!twRes.ok) throw new Error("API Error " + twRes.status);
        const twData = await twRes.json();
        const entries = twData['time-entries'] || [];
        
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        // --- BUCKETS ---
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        const startOfWeek = new Date(now);
        const day = startOfWeek.getDay() || 7; 
        if (day !== 1) startOfWeek.setHours(-24 * (day - 1));
        else startOfWeek.setHours(0,0,0,0);

        const startLastWeek = new Date(startOfWeek);
        startLastWeek.setDate(startLastWeek.getDate() - 7);
        const endLastWeek = new Date(startLastWeek);
        endLastWeek.setDate(endLastWeek.getDate() + 6);
        endLastWeek.setHours(23,59,59,999);

        // Stats Objects
        let users = {};
        let projects = {};
        
        // Weekly Pulse Stats
        let weekly = {
            thisWeek: { billable: 0, total: 0 },
            lastWeek: { billable: 0, total: 0 },
            month: { billable: 0, total: 0, users: {}, clients: {} }
        };

        entries.forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const date = new Date(e.date);
            const isBillable = e['isbillable'] === '1';
            const user = e['person-first-name'] + ' ' + e['person-last-name'];
            const client = e['project-name'];

            // 1. Main Dashboard Logic (Strictly This Month)
            if (date >= startOfMonth) {
                if (!users[user]) users[user] = 0;
                users[user] += hours; // Logged (Total) hours usually shown in leaderboard
                
                if (!projects[client]) projects[client] = { hours: 0 };
                if (isBillable) projects[client].hours += hours;

                // Weekly Pulse Month Bucket
                weekly.month.total += hours;
                if (isBillable) {
                    weekly.month.billable += hours;
                    weekly.month.users[user] = (weekly.month.users[user] || 0) + hours;
                    weekly.month.clients[client] = (weekly.month.clients[client] || 0) + hours;
                }
            }

            // 2. Weekly Buckets
            if (date >= startOfWeek) {
                weekly.thisWeek.total += hours;
                if (isBillable) weekly.thisWeek.billable += hours;
            } else if (date >= startLastWeek && date <= endLastWeek) {
                weekly.lastWeek.total += hours;
                if (isBillable) weekly.lastWeek.billable += hours;
            }
        });

        // Format Main Lists
        const userList = Object.keys(users).map(name => ({ name, hours: users[name] }));
        const projectList = Object.keys(projects).map(name => {
            const id = name.replace(/[^a-z0-9]/gi, '');
            const rate = savedRates[id] || savedRates[name] || GLOBAL_RATE;
            return { id, name, hours: projects[name].hours, rate: parseInt(rate), def: GLOBAL_RATE };
        });

        // Format Weekly Lists
        const sortMap = (map) => Object.entries(map).sort(([,a], [,b]) => b - a).slice(0, 5).map(([name, h]) => ({ name, hours: h }));

        const responseData = {
            users: userList,
            projects: projectList,
            // MERGED WEEKLY DATA INTO META FOR EFFICIENCY
            weekly: {
                month: { 
                    billable: weekly.month.billable, 
                    total: weekly.month.total,
                    topUsers: sortMap(weekly.month.users),
                    topClients: sortMap(weekly.month.clients)
                },
                thisWeek: weekly.thisWeek,
                lastWeek: weekly.lastWeek,
                ranges: {
                    this: `${startOfWeek.toLocaleDateString()} - Now`,
                    last: `${startLastWeek.toLocaleDateString()} - ${endLastWeek.toLocaleDateString()}`
                }
            },
            meta: { 
                serverTime: new Date().toISOString(), 
                globalRate: GLOBAL_RATE,
                cached: false
            }
        };

        // Cache It
        cache.data = { ...responseData, meta: { ...responseData.meta, cached: true } };
        cache.time = Date.now();

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify(responseData)
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};