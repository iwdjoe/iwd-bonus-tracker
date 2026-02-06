// V133 SURGICAL LIVE FETCH (Restoring V93 Logic)
// Fetches specific range (Last Week Start -> Tomorrow)
// 2 Pages (1000 entries) is plenty for 14 days.

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();
        
        // DATE LOGIC: Find Last Monday
        const d = new Date(now);
        const day = d.getDay(); 
        const diff = d.getDate() - day + (day == 0 ? -6 : 1); 
        const thisMon = new Date(d.setDate(diff));
        
        const lastMon = new Date(thisMon);
        lastMon.setDate(thisMon.getDate() - 7); // Start of data needed
        
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1); // End of data needed

        const formatDate = (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${y}${m}${day}`;
        };

        const fetchStartStr = formatDate(lastMon);
        const fetchEndStr = formatDate(tomorrow);

        // Fetch 2 Pages (Safe & Fast for ~14 days)
        const [p1, p2, ratesRes] = await Promise.all([
            fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}&sortorder=desc`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://${DOMAIN}/time_entries.json?page=2&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}&sortorder=desc`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } })
        ]);

        const d1 = p1.ok ? await p1.json() : {};
        const d2 = p2.ok ? await p2.json() : {};
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        const entries = [
            ...(d1['time-entries'] || []),
            ...(d2['time-entries'] || [])
        ];
        
        // CLEAN & FILTER
        const cleanEntries = entries.map(e => {
            const user = e['person-first-name'] + ' ' + e['person-last-name'];
            const isExcludedUser = user.match(/Isah/i) && user.match(/Ramos/i);
            const isInternal = e['project-name'].match(/IWD|Runners|Dominate/i);

            return {
                u: user,
                p: e['project-name'],
                pid: e['project-name'].replace(/[^a-z0-9]/gi, ''),
                d: e.date,
                h: parseFloat(e.hours) + (parseFloat(e.minutes) / 60),
                b: e['isbillable'] === '1',
                i: !!isInternal,
                x: !!isExcludedUser
            };
        }).filter(Boolean);

        return { 
            statusCode: 200, 
            body: JSON.stringify({ 
                entries: cleanEntries,
                rates: savedRates,
                globalRate: GLOBAL_RATE,
                meta: { count: cleanEntries.length }
            }) 
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};