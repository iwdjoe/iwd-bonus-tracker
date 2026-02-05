// MAIN BACKEND (V94 - PASSTHROUGH)
// Send Raw Data to Client. Let the Browser handle the date math.

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
        const now = new Date();
        
        // FETCH RANGE: Last 14 Days (Shortened to ensure we capture recent data within page limits)
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
        const rawEntries = [
            ...(d1['time-entries'] || []),
            ...(d2['time-entries'] || [])
        ];
        
        // MINIMAL PROCESSING
        // We just extract what the frontend needs to do the math
        const cleanEntries = rawEntries.map(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return null;
            return {
                u: e['person-first-name'] + ' ' + e['person-last-name'], // User
                p: e['project-name'], // Project
                pid: e['project-name'].replace(/[^a-z0-9]/gi, ''), // Project ID
                d: e.date, // Date YYYY-MM-DD
                h: parseFloat(e.hours) + (parseFloat(e.minutes) / 60), // Hours
                b: e['isbillable'] === '1' // Billable
            };
        }).filter(Boolean);

        const responseData = {
            entries: cleanEntries, // SEND RAW LIST
            rates: savedRates,
            globalRate: GLOBAL_RATE,
            meta: { 
                count: cleanEntries.length,
                serverTime: new Date().toISOString()
            }
        };
        
        cache.data = responseData;
        cache.time = Date.now();

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};