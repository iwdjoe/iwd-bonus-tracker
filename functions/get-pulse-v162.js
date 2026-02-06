// V162 - ISOLATION TEST (NO GITHUB)
// Removes GitHub dependency to rule out "Double API Timeout"
// Hardcodes rates temporarily.

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();
        
        // 14 Days Fixed Range
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

        // Fetch ONLY Teamwork
        const [p1, p2] = await Promise.all([
            fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${startStr}&toDate=${endStr}&sortorder=desc`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://${DOMAIN}/time_entries.json?page=2&pageSize=500&fromDate=${startStr}&toDate=${endStr}&sortorder=desc`, { headers: { 'Authorization': AUTH } })
        ]);

        const d1 = p1.ok ? await p1.json() : {};
        const d2 = p2.ok ? await p2.json() : {};
        
        // HARDCODED RATES (To bypass GitHub failure)
        const GLOBAL_RATE = 155;
        const savedRates = { "__GLOBAL_RATE__": 155 }; 

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
                meta: { count: cleanEntries.length, debug: "V162-NO-GITHUB" }
            }) 
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};