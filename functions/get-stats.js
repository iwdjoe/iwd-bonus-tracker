// MAIN BACKEND (V38 Logic - RESTORED)
let cache = { data: null, time: 0 };

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";
    
    if (cache.data && (Date.now() - cache.time < 60000)) {
        return { statusCode: 200, body: JSON.stringify(cache.data) };
    }

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();
        const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0].replace(/-/g, '');
        const today = now.toISOString().split('T')[0].replace(/-/g, '');

        const twRes = await fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${startMonth}&toDate=${today}`, { headers: { 'Authorization': AUTH } });
        if(!twRes.ok) throw new Error("Teamwork API " + twRes.status);
        const twData = await twRes.json();
        
        const ratesRes = await fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } });
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        const entries = twData['time-entries'] || [];
        let users = {};
        let projects = {};

        entries.forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const user = e['person-first-name'] + ' ' + e['person-last-name'];
            const project = e['project-name'];
            
            if (!users[user]) users[user] = 0;
            users[user] += hours;
            
            if (!projects[project]) projects[project] = { hours: 0 };
            projects[project].hours += hours;
        });

        const userList = Object.keys(users).map(name => ({ name, hours: users[name] }));
        const projectList = Object.keys(projects).map(name => {
            const id = name.replace(/[^a-z0-9]/gi, '');
            const rate = savedRates[id] || savedRates[name] || GLOBAL_RATE;
            return { id, name, hours: projects[name].hours, rate: parseInt(rate), def: 155 };
        });

        // Populate Weekly Real Data
        const weekStr = new Date();
        weekStr.setDate(weekStr.getDate() - ((weekStr.getDay() + 6) % 7)); // Start of this week (Mon)
        const weekStartIso = weekStr.toISOString().split('T')[0];

        // Recalculate buckets from the raw entries we already have
        let wStats = { 
            month: { b: 0, t: 0 }, 
            week: { b: 0, t: 0 } 
        };
        
        entries.forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            const h = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const isBill = e['isbillable'] === '1';
            
            // Month Total (All entries fetched are from this month)
            wStats.month.t += h;
            if (isBill) wStats.month.b += h;
            
            // Week Total
            if (e.date >= weekStartIso) {
                wStats.week.t += h;
                if (isBill) wStats.week.b += h;
            }
        });

        const responseData = {
            users: userList,
            projects: projectList,
            meta: { serverTime: new Date().toISOString(), globalRate: GLOBAL_RATE, cached: false },
            weekly: { 
                month: { billable: wStats.month.b, total: wStats.month.t },
                thisWeek: { billable: wStats.week.b, total: wStats.week.t },
                lastWeek: { billable: 0, total: 0 }, 
                ranges: { this: `${weekStartIso} - Now`, last: "Data Unavailable" }
            }
        };
        
        cache.data = responseData;
        cache.time = Date.now();

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};