// V121 SPLIT FETCH API
// Accepts ?range=this_week OR ?range=last_week
// Keeps payloads small to survive Netlify 10s Timeout

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
        
        if (range === 'last_week') {
            const lastMon = new Date(thisMon);
            lastMon.setDate(thisMon.getDate() - 7);
            const lastSun = new Date(lastMon);
            lastSun.setDate(lastMon.getDate() + 6);
            fetchStart = lastMon;
            fetchEnd = lastSun;
        } else {
            // this_week (Monday to Tomorrow)
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

        // Fetch 2 Pages (1000 entries) - plenty for 1 week
        const [p1, p2, ratesRes] = await Promise.all([
            fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://${DOMAIN}/time_entries.json?page=2&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}`, { headers: { 'Authorization': AUTH } }),
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
            const user = e['person-first-name'] + ' ' + e['person-last-name'];
            const isExcludedUser = user.match(/Isah/i) && user.match(/Ramos/i);
            const isInternal = e['project-name'].match(/IWD|Runners|Dominate/i);

            return {
                u: user,
                p: e['project-name'],
                pid: e['project-name'].replace(/[^a-z0-9]/gi, ''),
                d: e.date,
                h: parseFloat(e.hours) + (parseFloat(e.minutes) / 60),
                b: e['isbillable'] === '1' && !isInternal, // Billable (Strict)
                x: !!isExcludedUser // Isah flag
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