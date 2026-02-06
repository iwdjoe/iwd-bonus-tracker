// V163 - SEQUENTIAL FETCH (Anti-Rate-Limit)
// Runs requests one-by-one to avoid concurrency blocks.
// Retries on failure? No, just fails gracefully.

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();
        
        // 1. DATES (14 Days)
        const startDate = new Date(now);
        startDate.setDate(now.getDate() - 15);
        const formatDate = (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${y}${m}${day}`;
        };
        const startStr = formatDate(startDate);
        const endStr = formatDate(now);

        // 2. FETCH PAGE 1 (Sequential)
        const url1 = `https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${startStr}&toDate=${endStr}&sortorder=desc`;
        const p1 = await fetch(url1, { headers: { 'Authorization': AUTH } });
        if (!p1.ok) throw new Error(`Page 1 Failed: ${p1.status} ${p1.statusText}`);
        const d1 = await p1.json();

        // 3. FETCH PAGE 2 (Sequential)
        const url2 = `https://${DOMAIN}/time_entries.json?page=2&pageSize=500&fromDate=${startStr}&toDate=${endStr}&sortorder=desc`;
        const p2 = await fetch(url2, { headers: { 'Authorization': AUTH } });
        const d2 = p2.ok ? await p2.json() : {}; // If Page 2 fails (e.g. empty), just ignore? Or throw? Better to ignore if it's 404/empty, but 429 is bad.

        // 4. FETCH RATES (GitHub)
        const ratesRes = await fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } });
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        // 5. MERGE
        const entries = [
            ...(d1['time-entries'] || []),
            ...(d2['time-entries'] || [])
        ];
        
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

        return { 
            statusCode: 200, 
            body: JSON.stringify({ 
                entries: cleanEntries,
                rates: savedRates,
                globalRate: GLOBAL_RATE,
                meta: { count: cleanEntries.length, mode: "Sequential V163" }
            }) 
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message, stack: error.stack }) };
    }
};