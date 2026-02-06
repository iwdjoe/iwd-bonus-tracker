// V161 - THE "14 DAY" CACHED FETCH
// Strategy: Fetch exactly 14 days of history. Covers This Week + Last Week.
// Features: 
// 1. In-Memory Cache (60s) to preventing rate-limiting.
// 2. Strict 14-day window (Small data size ~600 entries).

let cache = {
    data: null,
    time: 0,
    range: ''
};

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";

    try {
        // 1. CACHE CHECK (60s)
        if (cache.data && (Date.now() - cache.time < 60000)) {
            return { statusCode: 200, body: JSON.stringify(cache.data) };
        }

        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();
        
        // 2. CALCULATE RANGE (Last 14 Days)
        // Ensures we capture This Week and Last Week fully.
        const startDate = new Date(now);
        startDate.setDate(now.getDate() - 15); // Buffer
        
        const formatDate = (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${y}${m}${day}`;
        };

        const startStr = formatDate(startDate);
        const endStr = formatDate(now);

        // 3. FETCH (2 Pages Max)
        const [p1, p2, ratesRes] = await Promise.all([
            fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${startStr}&toDate=${endStr}&sortorder=desc`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://${DOMAIN}/time_entries.json?page=2&pageSize=500&fromDate=${startStr}&toDate=${endStr}&sortorder=desc`, { headers: { 'Authorization': AUTH } }),
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
        
        // 4. PROCESS
        const cleanEntries = entries.map(e => {
            const user = e['person-first-name'] + ' ' + e['person-last-name'];
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            
            const isIsah = user.match(/Isah/i) && user.match(/Ramos/i);
            const isInternal = e['project-name'].match(/IWD|Runners|Dominate/i);

            return {
                u: user,
                p: e['project-name'],
                pid: e['project-name'].replace(/[^a-z0-9]/gi, ''),
                d: e.date,
                h: hours,
                b: e['isbillable'] === '1',
                i: !!isInternal,
                x: !!isIsah
            };
        }).filter(Boolean);

        const responseData = { 
            entries: cleanEntries,
            rates: savedRates,
            globalRate: GLOBAL_RATE,
            meta: { count: cleanEntries.length, cached: false, timestamp: Date.now() }
        };

        // 5. SET CACHE
        cache.data = { ...responseData, meta: { ...responseData.meta, cached: true } };
        cache.time = Date.now();

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};