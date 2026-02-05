const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');

    // Helper: Get Date Ranges
    const now = new Date();
    
    // 1. Month to Date
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // 2. This Week (Monday Start)
    const startWeek = new Date(now);
    const day = startWeek.getDay() || 7; 
    if (day !== 1) startWeek.setHours(-24 * (day - 1));
    else startWeek.setHours(0,0,0,0);
    
    // 3. Last Week
    const startLastWeek = new Date(startWeek);
    startLastWeek.setDate(startLastWeek.getDate() - 7);
    const endLastWeek = new Date(startLastWeek);
    endLastWeek.setDate(endLastWeek.getDate() + 6);
    endLastWeek.setHours(23,59,59,999);

    // 4. Year to Date (For Avg)
    const startYear = new Date(now.getFullYear(), 0, 1);

    // Helper: Fetch & Aggregate with TOP LISTS
    async function getStats(start, end) {
        // ... (existing fetch logic) ...
        const entries = data['time-entries'] || [];
        
        let billable = 0;
        let total = 0;
        let users = {};
        let clients = {};

        entries.forEach(e => {
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return; 

            total += hours;
            if (e['isbillable'] === '1') {
                billable += hours;
                
                // Track Contributors
                const user = e['person-first-name'] + ' ' + e['person-last-name'];
                if (!users[user]) users[user] = 0;
                users[user] += hours;

                // Track Clients
                const client = e['project-name']; // Or company name if available
                if (!clients[client]) clients[client] = 0;
                clients[client] += hours;
            }
        });

        // Sort Top Lists
        const topUsers = Object.entries(users)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([name, hours]) => ({ name, hours }));

        const topClients = Object.entries(clients)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([name, hours]) => ({ name, hours }));

        return { billable, total, nonBillable: total - billable, topUsers, topClients };
    }

    try {
        // Parallel Fetch for Speed
        const [monthStats, thisWeekStats, lastWeekStats, yearStats] = await Promise.all([
            getStats(startMonth, now),
            getStats(startWeek, now),
            getStats(startLastWeek, endLastWeek),
            getStats(startYear, now)
        ]);

        // Calculate Weeks Passed in Year (for Avg)
        const oneDay = 24 * 60 * 60 * 1000;
        const diffDays = Math.round(Math.abs((now - startYear) / oneDay));
        const weeksPassed = Math.max(diffDays / 7, 1);

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({
                month: monthStats,
                thisWeek: thisWeekStats,
                lastWeek: lastWeekStats,
                year: {
                    ...yearStats,
                    weeklyAvg: yearStats.billable / weeksPassed
                },
                meta: {
                    thisWeekRange: `${startWeek.toLocaleDateString()} - Now`,
                    lastWeekRange: `${startLastWeek.toLocaleDateString()} - ${endLastWeek.toLocaleDateString()}`
                }
            })
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};