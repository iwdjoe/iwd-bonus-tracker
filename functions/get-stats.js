// Main Dashboard Backend
// Fetches billable hours for a given month (defaults to current), with pagination

let cache = {};

// ── Rate Limiter (30 requests/min per IP) ─────────────────────────────────────
const rateLimitMap = {};
function isRateLimited(ip, limit = 30, windowMs = 60000) {
    const now = Date.now();
    if (!rateLimitMap[ip] || now - rateLimitMap[ip].start > windowMs) {
        rateLimitMap[ip] = { count: 1, start: now };
        return false;
    }
    rateLimitMap[ip].count++;
    return rateLimitMap[ip].count > limit;
}
// ─────────────────────────────────────────────────────────────────────────────

exports.handler = async function(event, context) {
    // ── Authentication ────────────────────────────────────────────────────────
    // Prefer Netlify Identity's clientContext (auto-decoded JWT). If unavailable
    // (e.g. Identity middleware not populating context), fall back to manually
    // decoding the JWT from the Authorization header.
    let user = context.clientContext && context.clientContext.user;

    if (!user) {
        const authHeader = event.headers && (event.headers.authorization || event.headers.Authorization);
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const payload = authHeader.substring(7).split('.')[1];
                user = JSON.parse(Buffer.from(payload, 'base64').toString());
            } catch (_) { /* malformed token */ }
        }
    }

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

    const ip = (event.headers && (event.headers['x-forwarded-for'] || event.headers['client-ip'])) || 'unknown';
    if (isRateLimited(ip)) {
        return { statusCode: 429, body: JSON.stringify({ error: 'Too many requests. Please wait a moment.' }) };
    }

    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN;
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT;
    const REPO = "iwdjoe/iwd-bonus-tracker";

    // ── Standardize "now" to the team's timezone (Poland — CET/CEST) ────────────
    // The team's workday (incl. the 9AM meeting) runs on Poland time. Netlify
    // Functions execute on servers running UTC, and reading new Date() directly
    // meant "today"/"this month" flipped over at UTC midnight — hours before or
    // after the actual Poland business day boundary — producing inconsistent
    // numbers. This pins the month/day boundaries used everywhere below to
    // TEAM_TIMEZONE, regardless of server TZ.
    const TEAM_TIMEZONE = 'Europe/Warsaw';
    function getTeamParts() {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: TEAM_TIMEZONE,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        }).formatToParts(new Date());
        const p = {};
        parts.forEach(part => { if (part.type !== 'literal') p[part.type] = part.value; });
        let hour = parseInt(p.hour, 10);
        if (hour === 24) hour = 0; // midnight edge case from hour12:false
        return {
            year: parseInt(p.year, 10),
            month: parseInt(p.month, 10) - 1, // 0-indexed, matches JS Date convention
            day: parseInt(p.day, 10),
            hour, minute: parseInt(p.minute, 10), second: parseInt(p.second, 10)
        };
    }
    const teamNow = getTeamParts();
    const todayTeamStr = `${teamNow.year}${String(teamNow.month + 1).padStart(2, '0')}${String(teamNow.day).padStart(2, '0')}`;
    // ─────────────────────────────────────────────────────────────────────────────

    // Parse optional month param (YYYY-MM) or default to current month (team's timezone)
    const qMonth = (event.queryStringParameters && event.queryStringParameters.month) || null;
    let year, month;

    if (qMonth && /^\d{4}-\d{2}$/.test(qMonth)) {
        const parts = qMonth.split('-');
        const parsedYear = parseInt(parts[0], 10);
        const parsedMonth = parseInt(parts[1], 10);
        if (parsedYear < 2020 || parsedYear > 2030 || parsedMonth < 1 || parsedMonth > 12) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid month parameter. Year must be 2020–2030, month must be 01–12.' }) };
        }
        year = parsedYear;
        month = parsedMonth - 1; // JS months are 0-indexed
    } else {
        year = teamNow.year;
        month = teamNow.month;
    }

    const cacheKey = `${year}-${month}`;
    const isCurrentMonth = (year === teamNow.year && month === teamNow.month);

    // CACHE: 60s for current month, 5 min for past months
    // Cache holds the expensive Teamwork-derived data only (userList, rawProjects).
    // Rates are always re-read from Blobs so live rate edits surface immediately.
    const cacheTTL = isCurrentMonth ? 60000 : 300000;
    const cacheHit = cache[cacheKey] && (Date.now() - cache[cacheKey].time < cacheTTL);

    try {
        const { readRates } = require('./_lib/rates-store');

        let userList, rawProjects, todayBillableHours;

        if (cacheHit) {
            // Reuse the expensive Teamwork aggregation; rates re-applied below.
            ({ userList, rawProjects, todayBillableHours } = cache[cacheKey].data);
        } else {
            const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
            const startDate = `${year}${String(month + 1).padStart(2, '0')}01`;

            // For current month use today (team's timezone); for past months use last day of that month
            let endDate;
            if (isCurrentMonth) {
                endDate = todayTeamStr;
            } else {
                const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
                endDate = `${year}${String(month + 1).padStart(2, '0')}${String(lastDay).padStart(2, '0')}`;
            }

            const twRes1 = await fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${startDate}&toDate=${endDate}`, { headers: { 'Authorization': AUTH } });
            if(!twRes1.ok) throw new Error("Teamwork API " + twRes1.status);
            const twData1 = await twRes1.json();

            let entries = twData1['time-entries'] || [];

            // Fetch all remaining pages until we get a partial page (max 5 pages = 2,500 entries)
            const MAX_PAGES = 5;
            let page = 2;
            while (entries.length === (page - 1) * 500 && page <= MAX_PAGES) {
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

            let users = Object.create(null);
            let projects = Object.create(null);

            // Track today's billable hours separately for timezone-neutral projections
            const todayStr = isCurrentMonth ? todayTeamStr : '';
            todayBillableHours = 0;

            entries.forEach(e => {
                if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
                if (e['isbillable'] !== '1') return;

                const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
                const user = e['person-first-name'] + ' ' + e['person-last-name'];
                const pid  = String(e['project-id']);    // stable Teamwork project ID
                const name = e['project-name'];          // display name — may change over time

                if (isCurrentMonth && e.date === todayStr) {
                    todayBillableHours += hours;
                }

                if (!users[user]) users[user] = { hours: 0, contractor: false };
                users[user].hours += hours;
                if (CONTRACTORS.includes(user)) users[user].contractor = true;

                // Group by project ID so renamed projects don't create duplicate entries.
                // Always overwrite name so the latest Teamwork name is shown.
                if (!projects[pid]) projects[pid] = { name, hours: 0 };
                else projects[pid].name = name;
                projects[pid].hours += hours;
            });

            userList = Object.keys(users).map(name => ({ name, hours: users[name].hours, contractor: users[name].contractor }));
            rawProjects = projects;

            cache[cacheKey] = {
                data: { userList, rawProjects, todayBillableHours },
                time: Date.now()
            };
        }

        // Always read rates fresh so live rate edits take effect immediately.
        const savedRates = await readRates().catch(() => ({}));
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        const projectList = Object.keys(rawProjects).map(pid => {
            const name     = rawProjects[pid].name;
            const legacyId = name.replace(/[^a-z0-9]/gi, ''); // backward-compat key for existing rates.json entries
            const rate     = savedRates[pid] || savedRates[legacyId] || savedRates[name] || GLOBAL_RATE;
            return { id: pid, name, hours: rawProjects[pid].hours, rate: parseInt(rate), def: GLOBAL_RATE };
        });

        const responseData = {
            users: userList,
            projects: projectList,
            meta: {
                serverTime: new Date().toISOString(),
                globalRate: GLOBAL_RATE,
                cached: cacheHit,
                month: `${year}-${String(month + 1).padStart(2, '0')}`,
                isCurrentMonth,
                todayBillableHours: isCurrentMonth ? todayBillableHours : 0
            }
        };

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
