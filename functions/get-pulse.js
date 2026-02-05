// NEW DEDICATED PULSE API (V100)
// Fetches last 45 days to handle Weekly Stats safely.

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();
        
        // FETCH 45 DAYS (Safe Range)
        const fetchStart = new Date(now);
        fetchStart.setDate(now.getDate() - 45);
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

        // FETCH 2 PAGES (1000 entries) - Safe Speed Limit
        // Fetching 3+ pages causes timeouts. 1000 entries is ~20 days of heavy data.
        // This is the max we can do reliably on the free tier.
        const [p1, p2] = await Promise.all([
            fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}&sortorder=desc`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://${DOMAIN}/time_entries.json?page=2&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}&sortorder=desc`, { headers: { 'Authorization': AUTH } })
        ]);

        const d1 = p1.ok ? await p1.json() : {};
        const d2 = p2.ok ? await p2.json() : {};
        
        const ratesRes = await fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } });
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        const entries = [
            ...(d1['time-entries'] || []),
            ...(d2['time-entries'] || [])
        ];
        
        const cleanEntries = entries.map(e => {
            // DO NOT FILTER INTERNAL PROJECTS
            // We need them for the Total Hours denominator to match Teamwork's 37% calculation
            
            const user = e['person-first-name'] + ' ' + e['person-last-name'];
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            
            // Special Flag for Isah Ramos (Robust Check: Contains Isah AND Ramos)
            const isExcludedUser = user.match(/Isah/i) && user.match(/Ramos/i);

            // Is Internal Project? (IWD/Runners/Dominate)
            const isInternal = e['project-name'].match(/IWD|Runners|Dominate/i);

            return {
                u: user,
                p: e['project-name'],
                pid: e['project-name'].replace(/[^a-z0-9]/gi, ''),
                d: e.date,
                h: hours,
                // Billable Logic: Must be marked billable AND NOT internal (safety check)
                b: e['isbillable'] === '1' && !isInternal,
                x: !!isExcludedUser // Excluded flag
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