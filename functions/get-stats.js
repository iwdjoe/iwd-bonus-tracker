// MAIN BACKEND (V83 - OPTIMIZED RANGE FETCH)
let cache = { data: null, time: 0 };

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";
    
    // CACHE: 2 Minutes (Balance freshness vs speed)
    if (cache.data && (Date.now() - cache.time < 120000)) {
        return { statusCode: 200, body: JSON.stringify(cache.data) };
    }

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();

        // 1. DATE MATH (Crucial for "Last Week" crossing month boundaries)
        const ONE_DAY = 24 * 60 * 60 * 1000;
        
        // This Week (Mon-Sun)
        const thisWeekStart = new Date(now);
        thisWeekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7)); 
        thisWeekStart.setHours(0,0,0,0);
        
        // Last Week (Mon-Sun)
        const lastWeekStart = new Date(thisWeekStart);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
        const lastWeekEnd = new Date(thisWeekStart); // Ends when this week starts
        
        // Fetch Range: Start from Last Week's Monday to Today
        // This is much smaller than "Current Month" if we are early in the month!
        // But to be safe for "Monthly Stats", we need MAX(StartOfMonth, LastWeekStart)
        // Actually, we need BOTH. Let's just fetch from the EARLIER of the two.
        
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const fetchStart = (lastWeekStart < startOfMonth) ? lastWeekStart : startOfMonth;
        
        const fetchStartStr = fetchStart.toISOString().split('T')[0].replace(/-/g, '');
        const todayStr = now.toISOString().split('T')[0].replace(/-/g, '');

        // 2. FETCH (Optimized Range)
        // We only fetch what we strictly need for the dashboard
        const twRes = await fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${fetchStartStr}&toDate=${todayStr}`, { headers: { 'Authorization': AUTH } });
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

        const thisWeekIso = thisWeekStart.toISOString().split('T')[0];
        const lastWeekIso = lastWeekStart.toISOString().split('T')[0];
        const monthStartIso = startOfMonth.toISOString().split('T')[0];

        entries.forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const isBill = e['isbillable'] === '1';
            const date = e.date; // YYYY-MM-DD format
            
            // --- MAIN DASHBOARD & LISTS (Current Month Only) ---
            if (date >= monthStartIso) {
                const user = e['person-first-name'] + ' ' + e['person-last-name'];
                const project = e['project-name'];
                
                // USER LIST: Only count BILLABLE hours if requested? 
                // User asked: "Top contributors should be only using the billable hours."
                if (isBill) {
                    if (!users[user]) users[user] = 0;
                    users[user] += hours;
                }
                
                // PROJECT LIST: Keep Total Hours for now (standard practice), or switch to billable?
                // Keeping Total for Projects to match Main Dashboard unless asked otherwise.
                if (!projects[project]) projects[project] = { hours: 0 };
                projects[project].hours += hours;
            }

            // --- WEEKLY PULSE (Range Independent) ---
            // This Week
            if (date >= thisWeekIso) {
                wStats.thisWeek.t += hours;
                if (isBill) wStats.thisWeek.b += hours;
            }
            // Last Week
            else if (date >= lastWeekIso && date < thisWeekIso) {
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
                ranges: { this: `${thisWeekIso} - Now`, last: `${lastWeekIso} - ${thisWeekIso}` }
            }
        };
        
        cache.data = responseData;
        cache.time = Date.now();

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};