// MAIN BACKEND (V86 - BULLETPROOF DATE LOGIC)
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
        
        // 1. BULLETPROOF DATES
        // We calculate everything based on "Now"
        const now = new Date();
        const safeNow = new Date(now.getTime()); // Clone to avoid mutation side effects

        // Get "Today at Midnight" to normalize comparisons
        const today = new Date(safeNow);
        today.setHours(0,0,0,0);

        // Calculate Start of This Week (Monday)
        // Day 0 is Sunday, 1 is Monday.
        // If Sunday (0), we want -6 days. If Monday (1), we want 0 days.
        const dayOfWeek = today.getDay(); 
        const distToMonday = (dayOfWeek + 6) % 7;
        const startOfThisWeek = new Date(today);
        startOfThisWeek.setDate(today.getDate() - distToMonday);

        // Calculate Start/End of Last Week
        const startOfLastWeek = new Date(startOfThisWeek);
        startOfLastWeek.setDate(startOfThisWeek.getDate() - 7);
        
        const endOfLastWeek = new Date(startOfThisWeek);
        endOfLastWeek.setDate(startOfThisWeek.getDate() - 1); // Sunday of last week

        // Calculate Start of Month (for Dashboard)
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // 2. FETCH STRATEGY: BRUTE FORCE SAFETY
        // Fetch last 45 days. Why? Because it's safe. It covers last week, this week, and the start of the month easily.
        // We will filter strictly in memory.
        const fetchStartDate = new Date(today);
        fetchStartDate.setDate(today.getDate() - 45); 

        const fetchEndDate = new Date(today);
        fetchEndDate.setDate(today.getDate() + 2); // Future-proof for timezones

        const toApiDate = (d) => d.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
        const toIsoDate = (d) => d.toISOString().split('T')[0]; // YYYY-MM-DD

        const fromDateStr = toApiDate(fetchStartDate);
        const toDateStr = toApiDate(fetchEndDate);

        // API Call
        const twRes = await fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${fromDateStr}&toDate=${toDateStr}`, { headers: { 'Authorization': AUTH } });
        if(!twRes.ok) throw new Error("Teamwork API " + twRes.status);
        const twData = await twRes.json();
        
        // Rates fetch
        const ratesRes = await fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } });
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        const entries = twData['time-entries'] || [];
        
        // 3. STATS BUCKETS
        let users = {};
        let projects = {};
        let wStats = { 
            thisWeek: { b: 0, t: 0 }, 
            lastWeek: { b: 0, t: 0 } 
        };

        // Date Strings for Strict Comparison
        const s_thisWeek = toIsoDate(startOfThisWeek);
        const s_lastWeekStart = toIsoDate(startOfLastWeek);
        const s_lastWeekEnd = toIsoDate(endOfLastWeek);
        const s_monthStart = toIsoDate(startOfMonth);

        entries.forEach(e => {
            // Ignore Internal Projects
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const isBill = e['isbillable'] === '1';
            const date = e.date; // YYYY-MM-DD from Teamwork

            // A. MAIN DASHBOARD (Monthly)
            if (date >= s_monthStart) {
                const user = e['person-first-name'] + ' ' + e['person-last-name'];
                const project = e['project-name'];
                
                if (isBill) {
                    if (!users[user]) users[user] = 0;
                    users[user] += hours;
                }
                
                if (!projects[project]) projects[project] = { hours: 0 };
                projects[project].hours += hours;
            }

            // B. WEEKLY PULSE
            
            // "This Week": >= Monday of this week
            if (date >= s_thisWeek) {
                wStats.thisWeek.t += hours;
                if (isBill) wStats.thisWeek.b += hours;
            }
            // "Last Week": >= Last Monday AND <= Last Sunday
            else if (date >= s_lastWeekStart && date <= s_lastWeekEnd) {
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
            meta: { serverTime: new Date().toISOString(), globalRate: GLOBAL_RATE, cached: false, v: 86 },
            weekly: { 
                thisWeek: { billable: wStats.thisWeek.b, total: wStats.thisWeek.t },
                lastWeek: { billable: wStats.lastWeek.b, total: wStats.lastWeek.t }, 
                ranges: { 
                    this: `${s_thisWeek} -> Now`, 
                    last: `${s_lastWeekStart} -> ${s_lastWeekEnd}`,
                    month: `${s_monthStart} -> Now`
                }
            }
        };
        
        cache.data = responseData;
        cache.time = Date.now();

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};