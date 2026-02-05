// MAIN BACKEND (V80 - Extended Range + Safe Filtering)
let cache = { data: null, time: 0 };

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";
    
    // CACHE: 5 Minutes to reduce API load
    if (cache.data && (Date.now() - cache.time < 300000)) {
        return { statusCode: 200, body: JSON.stringify(cache.data) };
    }

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();
        
        // 1. DATE SETUP
        // Fetch 35 days back to ensure we cover "Last Week" even at start of month
        const fetchStart = new Date(now);
        fetchStart.setDate(now.getDate() - 35);
        const fetchStartStr = fetchStart.toISOString().split('T')[0].replace(/-/g, '');
        const today = now.toISOString().split('T')[0].replace(/-/g, '');
        
        // Calculate Month Start for Main Dashboard Filter
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthStartIso = monthStart.toISOString().split('T')[0];

        // Calculate Week Ranges
        const thisMon = new Date(now);
        thisMon.setDate(thisMon.getDate() - ((thisMon.getDay() + 6) % 7)); // This Monday
        const thisMonIso = thisMon.toISOString().split('T')[0];
        
        const lastMon = new Date(thisMon);
        lastMon.setDate(lastMon.getDate() - 7); // Last Monday
        const lastMonIso = lastMon.toISOString().split('T')[0];

        // 2. FETCH DATA
        const twRes = await fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${fetchStartStr}&toDate=${today}`, { headers: { 'Authorization': AUTH } });
        if(!twRes.ok) throw new Error("Teamwork API " + twRes.status);
        const twData = await twRes.json();
        
        const ratesRes = await fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } });
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        const entries = twData['time-entries'] || [];
        
        // 3. AGGREGATE
        let users = {};
        let projects = {};
        let wStats = { 
            thisWeek: { b: 0, t: 0 }, 
            lastWeek: { b: 0, t: 0 } 
        };

        entries.forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const isBill = e['isbillable'] === '1';
            const date = e.date;

            // MAIN DASHBOARD: Only count if in Current Month
            if (date >= monthStartIso) {
                const user = e['person-first-name'] + ' ' + e['person-last-name'];
                const project = e['project-name'];
                
                if (!users[user]) users[user] = 0;
                users[user] += hours;
                
                if (!projects[project]) projects[project] = { hours: 0 };
                projects[project].hours += hours;
            }

            // PULSE DASHBOARD: Weekly Totals (Independent of Month)
            if (date >= thisMonIso) {
                wStats.thisWeek.t += hours;
                if (isBill) wStats.thisWeek.b += hours;
            } else if (date >= lastMonIso && date < thisMonIso) {
                wStats.lastWeek.t += hours;
                if (isBill) wStats.lastWeek.b += hours;
            }
        });

        const userList = Object.keys(users).map(name => ({ name, hours: users[name] }));
        const projectList = Object.keys(projects).map(name => {
            const id = name.replace(/[^a-z0-9]/gi, '');
            const rate = savedRates[id] || savedRates[name] || GLOBAL_RATE;
            return { id, name, hours: projects[name].hours, rate: parseInt(rate), def: 155 };
        });

        const responseData = {
            users: userList,
            projects: projectList,
            meta: { serverTime: new Date().toISOString(), globalRate: GLOBAL_RATE, cached: false },
            weekly: { 
                thisWeek: { billable: wStats.thisWeek.b, total: wStats.thisWeek.t },
                lastWeek: { billable: wStats.lastWeek.b, total: wStats.lastWeek.t }, 
                ranges: { this: `${thisMonIso} - Now`, last: `${lastMonIso} - ${thisMonIso}` }
            }
        };
        
        cache.data = responseData;
        cache.time = Date.now();

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};