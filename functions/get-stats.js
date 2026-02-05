// MAIN BACKEND (V99 - FINAL CONVERGENCE)
// Restores V38 Logic exactly for Main Dashboard compatibility
// Adds minimal extension for Pulse Dashboard (Last Week)

let cache = { data: null, time: 0 };

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";
    
    // CACHE: 1 Minute
    if (cache.data && (Date.now() - cache.time < 60000)) {
        return { statusCode: 200, body: JSON.stringify(cache.data) };
    }

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();
        
        // DATE LOGIC (V38 Original + 7 Days Padding)
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const fetchStart = new Date(startOfMonth);
        fetchStart.setDate(fetchStart.getDate() - 7); // Go back 7 days to catch Last Week overlap
        
        const fetchEnd = new Date(now);
        fetchEnd.setDate(now.getDate() + 1);

        const formatDate = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}${m}${day}`;
        };

        const fetchStartStr = formatDate(fetchStart);
        const fetchEndStr = formatDate(fetchEnd);

        // API CALL
        const twRes = await fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}`, { headers: { 'Authorization': AUTH } });
        if(!twRes.ok) throw new Error("Teamwork API " + twRes.status);
        const twData = await twRes.json();
        
        const ratesRes = await fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } });
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        // PROCESS ENTRIES
        // We pass the raw list to the client so the client can do the filtering.
        // This ensures the Main Dashboard (which does client-side math) receives the raw data it expects.
        
        const rawEntries = twData['time-entries'] || [];
        
        // V38 COMPATIBILITY: We must return "users" and "projects" arrays for the Main Dashboard
        let users = {};
        let projects = {};
        const monthStartStr = formatDate(startOfMonth); // YYYYMMDD string for comparison

        rawEntries.forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            
            // Only aggregate for Main Dashboard if in Current Month
            const dateStr = e.date.replace(/-/g, '');
            if (dateStr >= monthStartStr) {
                const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
                const user = e['person-first-name'] + ' ' + e['person-last-name'];
                const project = e['project-name'];
                
                if (!users[user]) users[user] = 0;
                users[user] += hours;
                
                if (!projects[project]) projects[project] = { hours: 0 };
                projects[project].hours += hours;
            }
        });

        const userList = Object.keys(users).map(name => ({ name, hours: users[name] }));
        const projectList = Object.keys(projects).map(name => {
            const id = name.replace(/[^a-z0-9]/gi, '');
            const rate = savedRates[id] || savedRates[name] || GLOBAL_RATE;
            return { id, name, hours: projects[name].hours, rate: parseInt(rate), def: 155 };
        });

        // FOR PULSE: We send a simplified list of ALL fetched entries (including Last Week)
        const pulseEntries = rawEntries.map(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return null;
            return {
                u: e['person-first-name'] + ' ' + e['person-last-name'],
                p: e['project-name'],
                pid: e['project-name'].replace(/[^a-z0-9]/gi, ''),
                d: e.date,
                h: parseFloat(e.hours) + (parseFloat(e.minutes) / 60),
                b: e['isbillable'] === '1'
            };
        }).filter(Boolean);

        const responseData = {
            // V38 Fields (Restores Main Dashboard)
            users: userList,
            projects: projectList,
            meta: { serverTime: new Date().toISOString(), globalRate: GLOBAL_RATE, cached: false },
            
            // V99 Fields (For Pulse Dashboard)
            entries: pulseEntries,
            rates: savedRates
        };
        
        cache.data = responseData;
        cache.time = Date.now();

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};