// UPDATE PULSE CACHE (Background Function)
// Fetches from Teamwork -> Saves to pulse-cache.json in GitHub
// Run this via "Refresh Data" button or Cron

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();
        
        // FETCH RANGE: 45 DAYS
        const fetchStart = new Date(now);
        fetchStart.setDate(now.getDate() - 45);
        const fetchEnd = new Date(now);
        fetchEnd.setDate(now.getDate() + 1);
        
        const formatDate = (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${y}${m}${day}`;
        };

        const fetchStartStr = formatDate(fetchStart);
        const fetchEndStr = formatDate(fetchEnd);

        console.log(`[UPDATE] Fetching ${fetchStartStr} -> ${fetchEndStr}`);

        // Fetch 4 Pages (Robust Volume)
        const [p1, p2, p3, p4, ratesRes] = await Promise.all([
            fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}&sortorder=desc`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://${DOMAIN}/time_entries.json?page=2&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}&sortorder=desc`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://${DOMAIN}/time_entries.json?page=3&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}&sortorder=desc`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://${DOMAIN}/time_entries.json?page=4&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}&sortorder=desc`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } })
        ]);

        const d1 = p1.ok ? await p1.json() : {};
        const d2 = p2.ok ? await p2.json() : {};
        const d3 = p3.ok ? await p3.json() : {};
        const d4 = p4.ok ? await p4.json() : {};
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        const entries = [
            ...(d1['time-entries'] || []),
            ...(d2['time-entries'] || []),
            ...(d3['time-entries'] || []),
            ...(d4['time-entries'] || [])
        ];

        console.log(`[UPDATE] Found ${entries.length} entries. Processing...`);

        // PROCESS DATA
        const toStr = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        const d = new Date(now);
        const day = d.getDay(); 
        const diff = d.getDate() - day + (day == 0 ? -6 : 1); 
        
        const thisMon = new Date(d.setDate(diff));
        const thisSun = new Date(thisMon); thisSun.setDate(thisMon.getDate() + 6);
        
        const lastMon = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7);
        const lastSun = new Date(lastMon); lastSun.setDate(lastMon.getDate() + 6);
        
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        
        const thisWeekStr = toStr(thisMon);
        const thisWeekEnd = toStr(thisSun);
        const lastWeekStart = toStr(lastMon);
        const lastWeekEnd = toStr(lastSun);
        const monthStartStr = toStr(monthStart);

        let stats = {
            month: { b: 0, t: 0, rev: 0 },
            thisWeek: { b: 0, t: 0, t_adj: 0 }, 
            lastWeek: { b: 0, t: 0, t_adj: 0 }
        };
        
        let users = {};
        let projects = {};

        entries.forEach(e => {
            const dateStr = e.date;
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const isBill = e['isbillable'] === '1';
            const user = e['person-first-name'] + ' ' + e['person-last-name'];
            const project = e['project-name'];
            const pid = project.replace(/[^a-z0-9]/gi, '');
            const isInternal = project.match(/IWD|Runners|Dominate/i);
            const isIsah = user.match(/Isah/i) && user.match(/Ramos/i);

            // MONTHLY (Strict: No Internal)
            if (dateStr >= monthStartStr) {
                if (!isInternal) {
                    stats.month.t += hours;
                    if (isBill) {
                        stats.month.b += hours;
                        const rate = savedRates[pid] || savedRates[project] || GLOBAL_RATE;
                        stats.month.rev += hours * rate;
                        if (!users[user]) users[user] = 0;
                        users[user] += hours;
                    }
                    if (!projects[project]) projects[project] = { hours: 0 };
                    projects[project].hours += hours;
                }
            }

            // WEEKLY (Loose: Include Internal, Exclude Isah)
            if (isIsah) return; 

            if (dateStr >= thisWeekStr && dateStr <= thisWeekEnd) {
                stats.thisWeek.t += hours;
                if (!isIsah) stats.thisWeek.t_adj += hours;
                if (isBill) stats.thisWeek.b += hours;
            } else if (dateStr >= lastWeekStart && dateStr <= lastWeekEnd) {
                stats.lastWeek.t += hours;
                if (!isIsah) stats.lastWeek.t_adj += hours;
                if (isBill) stats.lastWeek.b += hours;
            }
        });

        // BUILD CACHE OBJECT
        const cacheData = {
            meta: {
                updated: now.toISOString(),
                entriesCount: entries.length,
                ranges: { thisWeekStr, lastWeekStr }
            },
            pulse: stats,
            users: Object.keys(users).map(k => ({ name: k, hours: users[k] })).sort((a,b)=>b.hours-a.hours).slice(0,5),
            projects: Object.keys(projects).map(k => ({ name: k, hours: projects[k].hours })).sort((a,b)=>b.hours-a.hours).slice(0,5)
        };

        // SAVE TO GITHUB
        // 1. Get SHA
        const shaRes = await fetch(`https://api.github.com/repos/${REPO}/contents/pulse-cache.json`, { headers: { "Authorization": `token ${GH_TOKEN}` } });
        const shaData = await shaRes.json();
        const sha = shaData.sha;

        // 2. Update
        const updateRes = await fetch(`https://api.github.com/repos/${REPO}/contents/pulse-cache.json`, {
            method: 'PUT',
            headers: { "Authorization": `token ${GH_TOKEN}` },
            body: JSON.stringify({
                message: "Update Pulse Cache [Skip CI]", // Skip CI to avoid rebuild loop
                content: Buffer.from(JSON.stringify(cacheData, null, 2)).toString('base64'),
                sha: sha
            })
        });

        if (!updateRes.ok) throw new Error("GitHub Write Failed: " + updateRes.status);

        return { statusCode: 200, body: JSON.stringify({ success: true, cache: cacheData }) };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};