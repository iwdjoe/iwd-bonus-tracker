// NEW DEDICATED PULSE API
// Fetches broad range (Jan 1 -> Tomorrow) to guarantee data availability
// Filters strictly in memory.

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();
        
        // 1. FETCH EVERYTHING FROM JAN 1st
        // This is safe because we only return aggregated stats, not the raw list
        const fetchStartStr = '20250101'; // Hardcoded safe start (Jan 1 2025 - actually let's use current year dynamically)
        const currentYearStart = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0].replace(/-/g, '');
        
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0].replace(/-/g, '');

        // Fetch Time Entries
        const twRes = await fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${currentYearStart}&toDate=${tomorrowStr}`, { headers: { 'Authorization': AUTH } });
        const twData = await twRes.json();
        const entries = twData['time-entries'] || [];

        // Fetch Rates
        const ratesRes = await fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } });
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        // 2. DEFINE RANGES (Midnight-to-Midnight)
        // Helper to get YYYYMMDD int
        const toInt = (d) => parseInt(d.toISOString().split('T')[0].replace(/-/g, ''));

        // This Week (Monday Start)
        const d = new Date(now);
        const day = d.getDay(); 
        const diff = d.getDate() - day + (day == 0 ? -6 : 1); // adjust when day is sunday
        const thisMon = new Date(d.setDate(diff));
        thisMon.setHours(0,0,0,0);
        
        const lastMon = new Date(thisMon);
        lastMon.setDate(lastMon.getDate() - 7);
        
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const thisMonInt = toInt(thisMon);
        const lastMonInt = toInt(lastMon);
        const monthStartInt = toInt(monthStart);

        // 3. AGGREGATE
        let users = {};
        let projects = {};
        let stats = {
            month: { b: 0, t: 0 },
            thisWeek: { b: 0, t: 0 },
            lastWeek: { b: 0, t: 0 }
        };

        let debugCount = 0;

        entries.forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            
            // Normalize Date
            // e.date comes as YYYY-MM-DD or YYYYMMDD. Normalize to Int.
            const dateStr = e.date.replace(/-/g, '');
            const dateInt = parseInt(dateStr);
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const isBill = e['isbillable'] === '1';

            debugCount++;

            // MONTHLY (Main Dashboard Logic)
            if (dateInt >= monthStartInt) {
                const user = e['person-first-name'] + ' ' + e['person-last-name'];
                const project = e['project-name'];
                
                // Only count BILLABLE for Top Contributors (User Request)
                if (isBill) {
                    if (!users[user]) users[user] = 0;
                    users[user] += hours;
                }
                
                // Keep Total for Projects
                if (!projects[project]) projects[project] = { hours: 0 };
                projects[project].hours += hours;

                stats.month.t += hours;
                if (isBill) stats.month.b += hours;
            }

            // WEEKLY (Pulse Logic)
            if (dateInt >= thisMonInt) {
                stats.thisWeek.t += hours;
                if (isBill) stats.thisWeek.b += hours;
            } else if (dateInt >= lastMonInt && dateInt < thisMonInt) {
                stats.lastWeek.t += hours;
                if (isBill) stats.lastWeek.b += hours;
            }
        });

        // 4. FORMAT RESPONSE
        const userList = Object.keys(users).map(name => ({ name, hours: users[name] }));
        const projectList = Object.keys(projects).map(name => {
            const id = name.replace(/[^a-z0-9]/gi, '');
            const rate = savedRates[id] || savedRates[name] || GLOBAL_RATE;
            return { id, name, hours: projects[name].hours, rate: parseInt(rate), def: 155 };
        });

        return {
            statusCode: 200,
            body: JSON.stringify({
                users: userList,
                projects: projectList,
                meta: { 
                    debugEntriesFound: debugCount,
                    range: {
                        month: monthStartInt,
                        thisWeek: thisMonInt,
                        lastWeek: lastMonInt
                    }
                },
                pulse: {
                    month: stats.month,
                    thisWeek: stats.thisWeek,
                    lastWeek: stats.lastWeek
                }
            })
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};