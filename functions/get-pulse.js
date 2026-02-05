// NEW DEDICATED PULSE API (V119)
// Fetches last 14 days (Surgical Strike) to ensure speed and prevent timeouts.

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();
        
        // FETCH RANGE: 14 DAYS (Cover Last Week + This Week easily)
        const fetchStart = new Date(now);
        fetchStart.setDate(now.getDate() - 14);
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

        // Fetch 2 Pages just in case volume is crazy high in 14 days (1000 entries)
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
        
        const cleanEntries = entries.map(e => {
            // Include Internal Projects for Denominator, Exclude for Numerator logic handled in frontend
            const user = e['person-first-name'] + ' ' + e['person-last-name'];
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            
            // Special Flag for Isah Ramos
            const isExcludedUser = user.match(/Isah/i) && user.match(/Ramos/i);

            return {
                u: user,
                p: e['project-name'],
                pid: e['project-name'].replace(/[^a-z0-9]/gi, ''),
                d: e.date,
                h: hours,
                b: e['isbillable'] === '1', // Raw billable flag
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