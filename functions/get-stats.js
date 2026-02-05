// MAIN BACKEND (V85 - DATE FIX & SAFETY)
let cache = { data: null, time: 0 };

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";
    
    // CACHE: 1 Minute (Short cache for fast debugging)
    if (cache.data && (Date.now() - cache.time < 60000)) {
        return { statusCode: 200, body: JSON.stringify(cache.data) };
    }

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();

        // 1. DATE SETUP (V85 FIX)
        const thisWeekStart = new Date(now);
        thisWeekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7)); 
        thisWeekStart.setHours(0,0,0,0);
        
        const lastWeekStart = new Date(thisWeekStart);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
        
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        // FETCH RANGE: From (Earliest needed date) to (Tomorrow - to be safe)
        const fetchStart = (lastWeekStart < startOfMonth) ? lastWeekStart : startOfMonth;
        const fetchEnd = new Date(now);
        fetchEnd.setDate(now.getDate() + 1); // Fetch until tomorrow to catch all of today in any timezone

        const fetchStartStr = fetchStart.toISOString().split('T')[0].replace(/-/g, '');
        const fetchEndStr = fetchEnd.toISOString().split('T')[0].replace(/-/g, '');

        const twRes = await fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}`, { headers: { 'Authorization': AUTH } });
        if(!twRes.ok) throw new Error("Teamwork API " + twRes.status);
        const twData = await twRes.json();
        
        const ratesRes = await fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } });
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        const entries = twData['time-entries'] || [];
        
        let users = {};
        let projects = {};
        let wStats = { 
            thisWeek: { b: 0, t: 0 }, 
            lastWeek: { b: 0, t: 0 } 
        };

        // ISO Strings for Comparison
        const thisWeekIso = thisWeekStart.toISOString().split('T')[0];
        const lastWeekIso = lastWeekStart.toISOString().split('T')[0];
        const monthStartIso = startOfMonth.toISOString().split('T')[0];

        entries.forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const isBill = e['isbillable'] === '1';
            const date = e.date; 

            // MAIN STATS & LISTS (Current Month Only)
            if (date >= monthStartIso) {
                const user = e['person-first-name'] + ' ' + e['person-last-name'];
                const project = e['project-name'];
                
                if (isBill) {
                    if (!users[user]) users[user] = 0;
                    users[user] += hours;
                }
                
                if (!projects[project]) projects[project] = { hours: 0 };
                projects[project].hours += hours;
            }

            // PULSE STATS (Range Independent)
            // This Week
            if (date >= thisWeekIso) {
                wStats.thisWeek.t += hours;
                if (isBill) wStats.thisWeek.b += hours;
            }
            // Last Week (Strictly before this week starts)
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