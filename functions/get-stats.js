// Main Dashboard Backend
// Fetches billable hours for current month, with pagination

let cache = { data: null, time: 0 };

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN;
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT;
    const REPO = "iwdjoe/iwd-bonus-tracker";

    // CACHE: 60s
    if (cache.data && (Date.now() - cache.time < 60000)) {
        return { statusCode: 200, body: JSON.stringify(cache.data) };
    }

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();
        const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0].replace(/-/g, '');
        const today = now.toISOString().split('T')[0].replace(/-/g, '');

        // Fetch page 1 + rates in parallel
        const [twRes1, ratesRes] = await Promise.all([
            fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${startMonth}&toDate=${today}`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } })
        ]);

        if(!twRes1.ok) throw new Error("Teamwork API " + twRes1.status);
        const twData1 = await twRes1.json();
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        let entries = twData1['time-entries'] || [];

        // Fetch page 2 only if page 1 was full (500 entries)
        if (entries.length === 500) {
            const twRes2 = await fetch(`https://${DOMAIN}/time_entries.json?page=2&pageSize=500&fromDate=${startMonth}&toDate=${today}`, { headers: { 'Authorization': AUTH } });
            if (twRes2.ok) {
                const twData2 = await twRes2.json();
                entries = entries.concat(twData2['time-entries'] || []);
            }
        }

        let users = {};
        let projects = {};

        entries.forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            if (e['isbillable'] !== '1') return;

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

        const responseData = {
            users: userList,
            projects: projectList,
            meta: { serverTime: new Date().toISOString(), globalRate: GLOBAL_RATE, cached: false }
        };

        cache.data = responseData;
        cache.time = Date.now();

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
