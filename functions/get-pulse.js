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

        // Double Fetch to overcome 500 limit if needed, though usually not hit in 45 days unless huge volume
        // We'll stick to Page 1 for speed, usually enough. If zero data, we'll expand.
        const twRes = await fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}&sortorder=desc`, { headers: { 'Authorization': AUTH } });
        const twData = await twRes.json();
        
        const ratesRes = await fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } });
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        const entries = twData['time-entries'] || [];
        
        const cleanEntries = entries.map(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return null;
            return {
                u: e['person-first-name'] + ' ' + e['person-last-name'],
                p: e['project-name'],
                pid: e['project-name'].replace(/[^a-z0-9]/gi, ''),
                d: e.date,
                h: parseFloat(e.hours) + (parseFloat(e.minutes) / 60),
                b: e['isbillable'] === '1'
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