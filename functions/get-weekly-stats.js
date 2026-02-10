// WEEKLY DASHBOARD BACKEND (Dedicated File)
exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN;
    const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');

    const now = new Date();
    // Fetch last 40 days to be safe
    const startFetch = new Date(now);
    startFetch.setDate(now.getDate() - 40);
    const fmt = (d) => d.toISOString().split('T')[0].replace(/-/g, '');

    try {
        const url = `https://iwdagency.teamwork.com/time_entries.json?page=1&pageSize=500&fromDate=${fmt(startFetch)}&toDate=${fmt(now)}`;
        const res = await fetch(url, { headers: { 'Authorization': AUTH } });
        if(!res.ok) throw new Error("API " + res.status);
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
            const dateStr = e.date; // YYYY-MM-DD
            const isBillable = e['isbillable'] === '1';
            
            // String Comparison is safer than Date Obj for buckets
            const monthStr = startOfMonth.toISOString().split('T')[0];
            const weekStr = startOfWeek.toISOString().split('T')[0];
            const lastStartStr = startLastWeek.toISOString().split('T')[0];
            const lastEndStr = endLastWeek.toISOString().split('T')[0];

            if (dateStr >= monthStr) {
                stats.month.total += hours;
                if (isBillable) {
                    stats.month.billable += hours;
                    const user = e['person-first-name'] + ' ' + e['person-last-name'];
                    stats.month.users[user] = (stats.month.users[user] || 0) + hours;
                    const client = e['project-name'];
                    stats.month.clients[client] = (stats.month.clients[client] || 0) + hours;
                }
            }

            if (dateStr >= weekStr) {
                stats.thisWeek.total += hours;
                if (isBillable) stats.thisWeek.billable += hours;
            } else if (dateStr >= lastStartStr && dateStr <= lastEndStr) {
                stats.lastWeek.total += hours;
                if (isBillable) stats.lastWeek.billable += hours;
            }
        });

        const sortMap = (map) => Object.entries(map).sort(([,a], [,b]) => b - a).slice(0, 5).map(([name, h]) => ({ name, hours: h }));

        return {
            statusCode: 200,
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