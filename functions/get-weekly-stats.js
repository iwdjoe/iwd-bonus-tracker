exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');

    const now = new Date();
    // OPTIMIZATION: Only fetch last 35 days (covers this month + last week comparison)
    // Reduce page size to 250 to ensure fast response (pagination would be needed for perfect accuracy but speed is priority for dashboard)
    const startFetch = new Date(now);
    startFetch.setDate(now.getDate() - 35);
    
    const fmt = (d) => d.toISOString().split('T')[0].replace(/-/g, '');

    try {
        const url = `https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${fmt(startFetch)}&toDate=${fmt(now)}`;
        const res = await fetch(url, { headers: { 'Authorization': AUTH } });
        
        if(!res.ok) throw new Error("API Error " + res.status);
        
        const data = await res.json();
        const entries = data['time-entries'] || [];

        // Logic Partition
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        const startOfWeek = new Date(now);
        const day = startOfWeek.getDay() || 7; 
        if (day !== 1) startOfWeek.setHours(-24 * (day - 1));
        else startOfWeek.setHours(0,0,0,0);

        const startLastWeek = new Date(startOfWeek);
        startLastWeek.setDate(startLastWeek.getDate() - 7);
        const endLastWeek = new Date(startLastWeek);
        endLastWeek.setDate(endLastWeek.getDate() + 6);
        endLastWeek.setHours(23,59,59,999);

        const stats = {
            month: { billable: 0, total: 0, users: {}, clients: {} },
            thisWeek: { billable: 0, total: 0 },
            lastWeek: { billable: 0, total: 0 }
        };

        entries.forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return; 
            
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const date = new Date(e.date);
            const isBillable = e['isbillable'] === '1';

            if (date >= startOfMonth) {
                stats.month.total += hours;
                if (isBillable) {
                    stats.month.billable += hours;
                    const user = e['person-first-name'] + ' ' + e['person-last-name'];
                    stats.month.users[user] = (stats.month.users[user] || 0) + hours;
                    const client = e['project-name'];
                    stats.month.clients[client] = (stats.month.clients[client] || 0) + hours;
                }
            }

            if (date >= startOfWeek) {
                stats.thisWeek.total += hours;
                if (isBillable) stats.thisWeek.billable += hours;
            } else if (date >= startLastWeek && date <= endLastWeek) {
                stats.lastWeek.total += hours;
                if (isBillable) stats.lastWeek.billable += hours;
            }
        });

        const sortMap = (map) => Object.entries(map).sort(([,a], [,b]) => b - a).slice(0, 5).map(([name, h]) => ({ name, hours: h }));

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({
                month: { 
                    billable: stats.month.billable, 
                    total: stats.month.total,
                    topUsers: sortMap(stats.month.users),
                    topClients: sortMap(stats.month.clients)
                },
                thisWeek: stats.thisWeek,
                lastWeek: stats.lastWeek,
                meta: {
                    thisWeekRange: `${startOfWeek.toLocaleDateString()} - Now`,
                    lastWeekRange: `${startLastWeek.toLocaleDateString()} - ${endLastWeek.toLocaleDateString()}`
                }
            })
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};