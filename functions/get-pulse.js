// V123 OPTIMIZED SPLIT FETCH API
// this_week = 1 Page (Fast)
// last_week = 2 Pages (Deep)

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();
        const range = event.queryStringParameters.range || 'this_week';
        
        let fetchStart, fetchEnd;
        const d = new Date(now);
        const day = d.getDay(); 
        const diff = d.getDate() - day + (day == 0 ? -6 : 1); // Monday
        const thisMon = new Date(d.setDate(diff));
        thisMon.setHours(0,0,0,0);
        
        if (range === 'last_week') {
            const lastMon = new Date(thisMon);
            lastMon.setDate(thisMon.getDate() - 7);
            const lastSun = new Date(lastMon);
            lastSun.setDate(lastMon.getDate() + 6);
            fetchStart = lastMon;
            fetchEnd = lastSun;
        } else {
            fetchStart = thisMon;
            fetchEnd = new Date(now);
            fetchEnd.setDate(now.getDate() + 1);
        }

        const formatDate = (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${y}${m}${day}`;
        };

        const fetchStartStr = formatDate(fetchStart);
        const fetchEndStr = formatDate(fetchEnd);

        // OPTIMIZATION:
        // "This Week" only needs 1 page (500 entries covers 7 days easily).
        // "Last Week" might need 2 pages if it's very dense or pagination is weird.
        const pagesToFetch = (range === 'last_week') ? 2 : 1;

        const promises = [];
        for(let i=1; i<=pagesToFetch; i++) {
            promises.push(fetch(`https://${DOMAIN}/time_entries.json?page=${i}&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}&sortorder=desc`, { headers: { 'Authorization': AUTH } }));
        }
        // Always fetch rates
        promises.push(fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } }));

        const responses = await Promise.all(promises);
        
        const ratesRes = responses.pop(); // Last one is rates
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        const entries = [];
        for(const res of responses) {
            const data = res.ok ? await res.json() : {};
            if(data['time-entries']) entries.push(...data['time-entries']);
        }
        
        const cleanEntries = entries.map(e => {
            const user = e['person-first-name'] + ' ' + e['person-last-name'];
            const isExcludedUser = user.match(/Isah/i) && user.match(/Ramos/i);
            // INCLUDE INTERNAL for Denominator
            const isInternal = e['project-name'].match(/IWD|Runners|Dominate/i);

            return {
                u: user,
                p: e['project-name'],
                pid: e['project-name'].replace(/[^a-z0-9]/gi, ''),
                d: e.date,
                h: parseFloat(e.hours) + (parseFloat(e.minutes) / 60),
                b: e['isbillable'] === '1' && !isInternal, // Strict Billable
                x: !!isExcludedUser
            };
        }).filter(Boolean);

        return { 
            statusCode: 200, 
            body: JSON.stringify({ 
                entries: cleanEntries,
                rates: savedRates,
                globalRate: GLOBAL_RATE
            }) 
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};