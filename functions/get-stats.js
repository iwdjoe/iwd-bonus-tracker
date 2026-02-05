// MAIN BACKEND (V93 - DOUBLE BARREL FETCH)
// Fetches 1000 entries (Page 1 + Page 2) to overcome the chronological sort issue

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
        const toInt = (dateStr) => parseInt(dateStr.replace(/-/g, ''), 10);
        const now = new Date();
        
        // DATE LOGIC
        const dayOfWeek = now.getDay();
        const daysFromMonday = (dayOfWeek === 0) ? 6 : dayOfWeek - 1;
        const thisMonday = new Date(now);
        thisMonday.setDate(now.getDate() - daysFromMonday);
        thisMonday.setHours(0, 0, 0, 0);
        
        const lastMonday = new Date(thisMonday);
        lastMonday.setDate(thisMonday.getDate() - 7);
        
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        monthStart.setHours(0, 0, 0, 0);
        
        const formatDate = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };
        
        const thisWeekStart = formatDate(thisMonday);
        const lastWeekStart = formatDate(lastMonday);
        const monthStartStr = formatDate(monthStart);
        
        const thisWeekInt = toInt(thisWeekStart);
        const lastWeekInt = toInt(lastWeekStart);
        const monthStartInt = toInt(monthStartStr);
        
        // FETCH RANGE: Last 45 Days
        const fetchStart = new Date(now);
        fetchStart.setDate(now.getDate() - 45);
        const fetchEnd = new Date(now);
        fetchEnd.setDate(now.getDate() + 1);
        
        const fetchStartStr = formatDate(fetchStart).replace(/-/g, '');
        const fetchEndStr = formatDate(fetchEnd).replace(/-/g, '');

        console.log(`[GET-STATS] Fetching ${fetchStartStr} → ${fetchEndStr}`);

        // DOUBLE FETCH (Page 1 & 2)
        const [p1, p2, ratesRes] = await Promise.all([
            fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://${DOMAIN}/time_entries.json?page=2&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } })
        ]);

        const d1 = p1.ok ? await p1.json() : {};
        const d2 = p2.ok ? await p2.json() : {};
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        // Combine entries
        const entries = [
            ...(d1['time-entries'] || []),
            ...(d2['time-entries'] || [])
        ];
        
        console.log(`[GET-STATS] Found ${entries.length} entries (Merged P1+P2)`);
        
        let users = {};
        let projects = {};
        let stats = { 
            thisWeek: { b: 0, t: 0 }, 
            lastWeek: { b: 0, t: 0 },
            month: { b: 0, t: 0 }
        };

        const sampleEntries = [];

        entries.forEach((e, idx) => {
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const isBill = e['isbillable'] === '1';
            const dateStr = e.date; 
            const dateInt = toInt(dateStr);

            // Debug first/last entries to see range
            if (idx === 0 || idx === entries.length - 1) {
                sampleEntries.push({ idx, date: dateStr });
            }

            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            
            // MONTHLY
            if (dateInt >= monthStartInt) {
                const user = e['person-first-name'] + ' ' + e['person-last-name'];
                const project = e['project-name'];
                
                if (isBill) {
                    if (!users[user]) users[user] = 0;
                    users[user] += hours;
                }
                
                if (!projects[project]) projects[project] = { hours: 0 };
                projects[project].hours += hours;

                stats.month.t += hours;
                if (isBill) stats.month.b += hours;
            }

            // WEEKLY
            if (dateInt >= thisWeekInt) {
                stats.thisWeek.t += hours;
                if (isBill) stats.thisWeek.b += hours;
            } else if (dateInt >= lastWeekInt && dateInt < thisWeekInt) {
                stats.lastWeek.t += hours;
                if (isBill) stats.lastWeek.b += hours;
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
            meta: { 
                serverTime: new Date().toISOString(), 
                globalRate: GLOBAL_RATE, 
                cached: false,
                debug: {
                    entriesProcessed: entries.length,
                    rangeCovered: sampleEntries
                }
            },
            pulse: {
                thisWeek: { b: Math.round(stats.thisWeek.b), t: Math.round(stats.thisWeek.t) },
                lastWeek: { b: Math.round(stats.lastWeek.b), t: Math.round(stats.lastWeek.t) },
                month: { b: Math.round(stats.month.b), t: Math.round(stats.month.t) }
            }
        };
        
        cache.data = responseData;
        cache.time = Date.now();

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};