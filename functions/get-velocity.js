// Velocity & Unblocker Report Backend
// Fetches billable hours per project for velocity calculations

let cache = {};

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

exports.handler = async function(event, context) {
    // ── Authentication ──────────────────────────────────────────────────────
    let user = context.clientContext && context.clientContext.user;
    if (!user) {
        const authHeader = event.headers && (event.headers.authorization || event.headers.Authorization);
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const payload = authHeader.substring(7).split('.')[1];
                user = JSON.parse(Buffer.from(payload, 'base64').toString());
            } catch (_) {}
        }
    }
    if (!user) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized: login required' }) };
    }
    const email = (user.email || '').toLowerCase();
    if (!email.endsWith('@iwdagency.com')) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: @iwdagency.com account required' }) };
    }

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
    // Same fix as get-stats.js: pin month/day boundaries to TEAM_TIMEZONE
    // regardless of the server's own (UTC) clock.
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
        if (hour === 24) hour = 0;
        return {
            year: parseInt(p.year, 10),
            month: parseInt(p.month, 10) - 1,
            day: parseInt(p.day, 10),
            hour, minute: parseInt(p.minute, 10), second: parseInt(p.second, 10)
        };
    }
    const teamNow = getTeamParts();
    // ─────────────────────────────────────────────────────────────────────────────

    const qMonth = (event.queryStringParameters && event.queryStringParameters.month) || null;
    let year, month;

    if (qMonth && /^\d{4}-\d{2}$/.test(qMonth)) {
        const parts = qMonth.split('-');
        const parsedYear = parseInt(parts[0], 10);
        const parsedMonth = parseInt(parts[1], 10);
        if (parsedYear < 2020 || parsedYear > 2030 || parsedMonth < 1 || parsedMonth > 12) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid month parameter.' }) };
        }
        year = parsedYear;
        month = parsedMonth - 1;
    } else {
        year = teamNow.year;
        month = teamNow.month;
    }

    const cacheKey = `velocity-${year}-${month}`;
    const isCurrentMonth = (year === teamNow.year && month === teamNow.month);
    const cacheTTL = isCurrentMonth ? 60000 : 300000;
    const cacheHit = cache[cacheKey] && (Date.now() - cache[cacheKey].time < cacheTTL);

    try {
        const { readRates } = require('./_lib/rates-store');

        // Always read rates fresh; reuse cached Teamwork aggregation if hot.
        const savedRates = await readRates().catch(() => ({}));
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        // If cache hit: rebuild response from cached raw data + fresh rates
        if (cacheHit) {
            const cached = cache[cacheKey].data;
            const projectList = Object.keys(cached.rawProjects).map(pid => {
                const name = cached.rawProjects[pid].name;
                const legacyId = name.replace(/[^a-z0-9]/gi, '');
                const rate = savedRates[pid] || savedRates[legacyId] || savedRates[name] || GLOBAL_RATE;
                return {
                    id: pid,
                    name,
                    hours: Math.round(cached.rawProjects[pid].hours * 100) / 100,
                    rate: parseInt(rate),
                    people: cached.rawProjects[pid].people
                };
            }).sort((a, b) => b.hours - a.hours);

            return { statusCode: 200, body: JSON.stringify({
                projects: projectList,
                meta: { ...cached.meta, globalRate: GLOBAL_RATE, serverTime: new Date().toISOString() }
            }) };
        }

        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const startDate = `${year}${String(month + 1).padStart(2, '0')}01`;

        let endDate;
        if (isCurrentMonth) {
            endDate = `${teamNow.year}${String(teamNow.month + 1).padStart(2, '0')}${String(teamNow.day).padStart(2, '0')}`;
        } else {
            const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
            endDate = `${year}${String(month + 1).padStart(2, '0')}${String(lastDay).padStart(2, '0')}`;
        }

        const twRes1 = await fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${startDate}&toDate=${endDate}`, { headers: { 'Authorization': AUTH } });
        if (!twRes1.ok) throw new Error("Teamwork API " + twRes1.status);
        const twData1 = await twRes1.json();

        let entries = twData1['time-entries'] || [];

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

        // Aggregate by project
        let projects = Object.create(null);
        let totalHours = 0;

        entries.forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            if (e['isbillable'] !== '1') return;

            const hours  = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const pid    = String(e['project-id']); // stable Teamwork project ID
            const name   = e['project-name'];       // display name — may change over time

            // Group by project ID so renamed projects don't create duplicate entries.
            // Always overwrite name so the latest Teamwork name is shown.
            if (!projects[pid]) {
                projects[pid] = { name, hours: 0, people: Object.create(null) };
            } else {
                projects[pid].name = name;
            }
            projects[pid].hours += hours;
            totalHours += hours;

            const person = e['person-first-name'] + ' ' + e['person-last-name'];
            if (!projects[pid].people[person]) {
                projects[pid].people[person] = 0;
            }
            projects[pid].people[person] += hours;
        });

        const projectList = Object.keys(projects).map(pid => {
            const name     = projects[pid].name;
            const legacyId = name.replace(/[^a-z0-9]/gi, ''); // backward-compat key for existing rates.json entries
            const rate     = savedRates[pid] || savedRates[legacyId] || savedRates[name] || GLOBAL_RATE;
            return {
                id: pid,
                name,
                hours: Math.round(projects[pid].hours * 100) / 100,
                rate: parseInt(rate),
                people: projects[pid].people
            };
        }).sort((a, b) => b.hours - a.hours);

        const rawProjects = projects;

        // Calculate business days
        const monthStart = new Date(year, month, 1);
        const teamToday = new Date(teamNow.year, teamNow.month, teamNow.day);
        const monthEnd = isCurrentMonth ? teamToday : new Date(year, month + 1, 0);
        const totalMonthEnd = new Date(year, month + 1, 0);

        function countBusinessDays(start, end) {
            // Use UTC to avoid DST boundary issues (spring-forward can shift
            // the hour on setDate, causing the final day comparison to miss a day)
            const msPerDay = 86400000;
            const s = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
            const e = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
            let count = 0;
            for (let t = s; t <= e; t += msPerDay) {
                const dow = new Date(t).getUTCDay();
                if (dow !== 0 && dow !== 6) count++;
            }
            return count;
        }

        const businessDaysElapsed = countBusinessDays(monthStart, monthEnd);
        const totalBusinessDays = countBusinessDays(monthStart, totalMonthEnd);
        const weeksInMonth = totalBusinessDays / 5;
        const monthElapsed = totalBusinessDays > 0 ? businessDaysElapsed / totalBusinessDays : 0;

        const responseData = {
            projects: projectList,
            meta: {
                serverTime: new Date().toISOString(),
                globalRate: GLOBAL_RATE,
                month: `${year}-${String(month + 1).padStart(2, '0')}`,
                isCurrentMonth,
                totalHours: Math.round(totalHours * 100) / 100,
                businessDaysElapsed,
                totalBusinessDays,
                weeksInMonth: Math.round(weeksInMonth * 10) / 10,
                monthElapsed: Math.round(monthElapsed * 1000) / 1000
            }
        };

        // Cache raw aggregation only; rates are re-applied on every read.
        cache[cacheKey] = {
            data: { rawProjects, meta: responseData.meta },
            time: Date.now()
        };
        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
