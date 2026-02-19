// Main Dashboard Backend
// Fetches billable hours for a given month (defaults to current), with pagination

let cache = {};

exports.handler = async function(event, context) {
    // ── Authentication ────────────────────────────────────────────────────────
    // Netlify Identity decodes the Bearer JWT and exposes it via clientContext
    // when the request includes an Authorization header. We rely on that rather
    // than re-verifying the token ourselves.
    const user = context.clientContext && context.clientContext.user;

    if (!user) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Unauthorized: login required' })
        };
    }

    const email = (user.email || '').toLowerCase();
    if (!email.endsWith('@iwdagency.com')) {
        return {
            statusCode: 403,
            body: JSON.stringify({ error: 'Forbidden: @iwdagency.com account required' })
        };
    }
    // ─────────────────────────────────────────────────────────────────────────

    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN;
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT;
    const REPO = "iwdjoe/iwd-bonus-tracker";

    // Parse optional month param (YYYY-MM) or default to current month
    const now = new Date();
    const qMonth = (event.queryStringParameters && event.queryStringParameters.month) || null;
    let year, month;

    if (qMonth && /^\d{4}-\d{2}$/.test(qMonth)) {
        const parts = qMonth.split('-');
        year = parseInt(parts[0]);
        month = parseInt(parts[1]) - 1; // JS months are 0-indexed
    } else {
        year = now.getFullYear();
        month = now.getMonth();
    }

    const cacheKey = `${year}-${month}`;
    const isCurrentMonth = (year === now.getFullYear() && month === now.getMonth());

    // CACHE: 60s for current month, 5 min for past months
    const cacheTTL = isCurrentMonth ? 60000 : 300000;
    if (cache[cacheKey] && (Date.now() - cache[cacheKey].time < cacheTTL)) {
        return { statusCode: 200, body: JSON.stringify(cache[cacheKey].data) };
    }

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const startDate = new Date(year, month, 1).toISOString().split('T')[0].replace(/-/g, '');

        // For current month use today; for past months use last day of that month
        let endDate;
        if (isCurrentMonth) {
            endDate = now.toISOString().split('T')[0].replace(/-/g, '');
        } else {
            endDate = new Date(year, month + 1, 0).toISOString().split('T')[0].replace(/-/g, '');
        }

        // Fetch page 1 + rates in parallel
        const [twRes1, ratesRes] = await Promise.all([
            fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${startDate}&toDate=${endDate}`, { headers: { 'Authorization': AUTH } }),
            fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } })
        ]);

        if(!twRes1.ok) throw new Error("Teamwork API " + twRes1.status);
        const twData1 = await twRes1.json();
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        let entries = twData1['time-entries'] || [];

        // Fetch all remaining pages until we get a partial page
        let page = 2;
        while (entries.length === (page - 1) * 500 && page <= 20) {
            const res = await fetch(`https://${DOMAIN}/time_entries.json?page=${page}&pageSize=500&fromDate=${startDate}&toDate=${endDate}`, { headers: { 'Authorization': AUTH } });
            if (!res.ok) break;
            const data = await res.json();
            const pageEntries = data['time-entries'] || [];
            if (pageEntries.length === 0) break;
            entries = entries.concat(pageEntries);
            page++;
        }

        // Contractors: included in billable hours/revenue but excluded from bonus payouts
        const CONTRACTORS = ['Julian Stoddart'];

        let users = {};
        let projects = {};

        entries.forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            if (e['isbillable'] !== '1') return;

            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const user = e['person-first-name'] + ' ' + e['person-last-name'];
            const project = e['project-name'];

            if (!users[user]) users[user] = { hours: 0, contractor: false };
            users[user].hours += hours;
            if (CONTRACTORS.includes(user)) users[user].contractor = true;

            if (!projects[project]) projects[project] = { hours: 0 };
            projects[project].hours += hours;
        });

        const userList = Object.keys(users).map(name => ({ name, hours: users[name].hours, contractor: users[name].contractor }));
        const projectList = Object.keys(projects).map(name => {
            const id = name.replace(/[^a-z0-9]/gi, '');
            const rate = savedRates[id] || savedRates[name] || GLOBAL_RATE;
            return { id, name, hours: projects[name].hours, rate: parseInt(rate), def: GLOBAL_RATE };
        });

        const responseData = {
            users: userList,
            projects: projectList,
            meta: {
                serverTime: new Date().toISOString(),
                globalRate: GLOBAL_RATE,
                cached: false,
                month: `${year}-${String(month + 1).padStart(2, '0')}`,
                isCurrentMonth
            }
        };

        cache[cacheKey] = { data: responseData, time: Date.now() };

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
