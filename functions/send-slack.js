// Send Slack Bonus Update — Netlify Serverless Function
// POST /api/send-slack
// Body: { mode: "auto"|"green"|"yellow"|"red", preview: true/false }
//
// Env vars needed: SLACK_WEBHOOK_URL
// (Plus existing TEAMWORK_API_TOKEN, GITHUB_PAT for data fetch)

// ─── Bonus Tier Config ────────────────────────────────────────
const BONUS_TIERS = [
    { threshold: 160000, pool: 6000, label: 'Top Tier' },
    { threshold: 145000, pool: 5000, label: 'Tier 5' },
    { threshold: 130000, pool: 4000, label: 'Tier 4' },
    { threshold: 115000, pool: 3000, label: 'Tier 3' },
    { threshold: 100000, pool: 2000, label: 'Tier 2' },
    { threshold: 85000,  pool: 1000, label: 'Tier 1' },
];

function getPool(rev) {
    for (const tier of BONUS_TIERS) {
        if (rev >= tier.threshold) return tier.pool;
    }
    return 0;
}

function getTierLabel(rev) {
    for (const tier of BONUS_TIERS) {
        if (rev >= tier.threshold) return tier.label;
    }
    return 'Baseline';
}

// ─── Date Helpers ─────────────────────────────────────────────
function getTimezoneNow(timezone) {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    });
    const parts = {};
    formatter.formatToParts(now).forEach(({ type, value }) => { parts[type] = value; });
    return new Date(
        parseInt(parts.year), parseInt(parts.month) - 1, parseInt(parts.day),
        parseInt(parts.hour), parseInt(parts.minute), parseInt(parts.second)
    );
}

function getWorkDays(start, end) {
    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
        const day = cur.getDay();
        if (day !== 0 && day !== 6) count++;
        cur.setDate(cur.getDate() + 1);
    }
    return count;
}

// ─── Stats Calculation ────────────────────────────────────────
function calculateStats(data, timezone) {
    const now = getTimezoneNow(timezone);
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);

    const totalWorkDays = getWorkDays(monthStart, monthEnd);
    let currentWorkDay = getWorkDays(monthStart, now);
    if (now.getHours() < 17) currentWorkDay = Math.max(currentWorkDay - 1, 1);
    const daysRemaining = Math.max(totalWorkDays - currentWorkDay, 0);

    const projects = data.projects || [];
    const users = (data.users || []).filter(u => u.name && u.name.trim() !== '');
    const globalRate = (data.meta && data.meta.globalRate) || 155;

    const currentRevenue = projects.reduce((sum, p) => sum + (p.hours * p.rate), 0);
    const projectedRevenue = currentWorkDay > 0 ? (currentRevenue / currentWorkDay) * totalWorkDays : 0;
    const totalBillableHours = projects.reduce((sum, p) => sum + p.hours, 0);

    // Contractors excluded from leaderboard/bonus payouts
    const bonusEligible = users.filter(u => !u.contractor);
    const totalUserHours = bonusEligible.reduce((sum, u) => sum + u.hours, 0);
    const leaderboard = bonusEligible
        .sort((a, b) => b.hours - a.hours)
        .map(u => ({
            name: u.name,
            hours: u.hours,
            sharePct: totalUserHours > 0 ? (u.hours / totalUserHours) * 100 : 0,
        }));

    const activeMembers = users.filter(u => u.hours > 0).length;

    return {
        currentRevenue, projectedRevenue, currentWorkDay, totalWorkDays,
        daysRemaining, totalBillableHours, globalRate, leaderboard,
        activeMembers, date: now,
    };
}

// ─── Mode Detection ───────────────────────────────────────────
function determineMode(projectedRevenue) {
    if (projectedRevenue >= 85000) return 'green';
    if (projectedRevenue >= 68000) return 'yellow';
    return 'red';
}

function getModeDetails(mode, stats) {
    const { projectedRevenue, daysRemaining, activeMembers, globalRate } = stats;

    if (mode === 'green') {
        const pool = getPool(projectedRevenue);
        const tierLabel = getTierLabel(projectedRevenue);
        const isTopTier = projectedRevenue >= 160000;
        const nextTier = [...BONUS_TIERS].reverse().find(t => t.threshold > projectedRevenue);
        return { pool, tierLabel, isTopTier, nextTierPool: nextTier ? nextTier.pool : null, gapToNextTier: nextTier ? nextTier.threshold - projectedRevenue : 0 };
    }

    if (mode === 'yellow') {
        const gapTo85k = 85000 - projectedRevenue;
        const additionalHours = gapTo85k / globalRate;
        const hoursPerPersonPerDay = (activeMembers > 0 && daysRemaining > 0) ? additionalHours / activeMembers / daysRemaining : 0;
        return { gapTo85k, additionalHours, hoursPerPersonPerDay };
    }

    return {};
}

// ─── Message Formatting ───────────────────────────────────────
function formatCurrency(num) { return '$' + Math.round(num).toLocaleString('en-US'); }
function formatHours(num) { return num.toFixed(1); }
function formatPct(num) { return num.toFixed(1); }
const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

function formatMessage(stats, mode, modeDetails, dashboardUrl) {
    const { date, currentRevenue, projectedRevenue, currentWorkDay, totalWorkDays, daysRemaining, totalBillableHours, leaderboard } = stats;
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const lines = [];
    lines.push(`\u{1F680} *Team Bonus Update* \u2014 ${dayNames[date.getDay()]}, ${monthNames[date.getMonth()]} ${date.getDate()}`);
    lines.push('');
    lines.push('');

    if (mode === 'green') {
        lines.push(`\u{1F4B0} *We're on track for a ${formatCurrency(modeDetails.pool)} bonus pool!* (${modeDetails.tierLabel})`);
    } else if (mode === 'yellow') {
        lines.push(`\u26A1 *${formatCurrency(modeDetails.gapTo85k)} away from unlocking a $1,000 bonus pool*`);
    } else {
        lines.push(`\u{1F4CA} *Here's where we stand this month*`);
    }
    lines.push('');
    lines.push('');

    lines.push(`\u{1F4CA} *Revenue:* ${formatCurrency(currentRevenue)} current \u2192 ${formatCurrency(projectedRevenue)} projected`);
    lines.push(`\u23F3 *Day ${currentWorkDay} of ${totalWorkDays}* \u2014 ${daysRemaining} days remaining`);
    lines.push(`\u{1F550} *Billable Hours:* ${formatHours(totalBillableHours)} hrs logged`);
    lines.push('');
    lines.push('');

    const topN = Math.min(leaderboard.length, 3);
    if (topN > 0) {
        lines.push(`\u{1F3C6} *Top Contributors:*`);
        for (let i = 0; i < topN; i++) {
            const { name, hours, sharePct } = leaderboard[i];
            lines.push(`${MEDALS[i]} ${name} \u2014 ${formatHours(hours)} hrs (${formatPct(sharePct)}%)`);
        }
        lines.push('');
        lines.push('');
    }

    if (mode === 'green') {
        if (modeDetails.isTopTier) {
            lines.push(`\u{1F525} We're in Top Tier territory \u2014 keep this pace and we max out!`);
        } else {
            lines.push(`\u{1F4C8} Just ${formatCurrency(modeDetails.gapToNextTier)} more in projected revenue to reach the next tier (${formatCurrency(modeDetails.nextTierPool)} pool)`);
        }
    } else if (mode === 'yellow') {
        const { additionalHours, hoursPerPersonPerDay } = modeDetails;
        lines.push(`\u{1F4A1} That's ~${Math.round(additionalHours)} extra billable hours, or *${hoursPerPersonPerDay.toFixed(1)} hrs/person/day* over the next ${daysRemaining} days`);
    } else {
        lines.push(`\u{1F4AA} Let's keep building momentum \u2014 every billable hour counts`);
    }
    lines.push('');
    lines.push('');
    lines.push(`\u{1F449} <${dashboardUrl}|View Live Dashboard>`);

    return lines.join('\n');
}

// ─── Fetch Dashboard Data (reuses get-stats logic) ────────────
async function fetchDashboardData() {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN;
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT;
    const REPO = "iwdjoe/iwd-bonus-tracker";

    if (!TOKEN) throw new Error("TEAMWORK_API_TOKEN is not configured");

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
    const startDate = new Date(year, month, 1).toISOString().split('T')[0].replace(/-/g, '');
    const endDate = now.toISOString().split('T')[0].replace(/-/g, '');

    const [twRes1, ratesRes] = await Promise.all([
        fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${startDate}&toDate=${endDate}`, { headers: { 'Authorization': AUTH } }),
        fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } })
    ]);

    if (!twRes1.ok) throw new Error("Teamwork API " + twRes1.status);
    const twData1 = await twRes1.json();
    const savedRates = ratesRes.ok ? await ratesRes.json() : {};
    const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

    let entries = twData1['time-entries'] || [];

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

    return {
        users: userList,
        projects: projectList,
        meta: { globalRate: GLOBAL_RATE }
    };
}

// ─── Handler ──────────────────────────────────────────────────
exports.handler = async function(event) {
    // Only allow POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const modeFlag = body.mode || 'auto';
        const isPreview = body.preview === true;
        const timezone = 'Europe/Madrid';
        const dashboardUrl = process.env.DASHBOARD_URL || 'https://iwd-bonus-tracker.netlify.app';

        // Validate mode
        if (modeFlag !== 'auto' && !['green', 'yellow', 'red'].includes(modeFlag)) {
            return { statusCode: 400, body: JSON.stringify({ error: `Invalid mode "${modeFlag}". Use auto, green, yellow, or red.` }) };
        }

        // Fetch fresh data
        const data = await fetchDashboardData(event);
        const stats = calculateStats(data, timezone);

        // Determine mode
        const mode = modeFlag === 'auto' ? determineMode(stats.projectedRevenue) : modeFlag;
        const modeDetails = getModeDetails(mode, stats);
        const message = formatMessage(stats, mode, modeDetails, dashboardUrl);

        // Preview mode — return message without posting
        if (isPreview) {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    preview: true,
                    mode,
                    message,
                    stats: {
                        revenue: Math.round(stats.currentRevenue),
                        projected: Math.round(stats.projectedRevenue),
                        workDay: stats.currentWorkDay,
                        totalDays: stats.totalWorkDays,
                        daysLeft: stats.daysRemaining,
                        hours: parseFloat(stats.totalBillableHours.toFixed(1)),
                        pool: getPool(stats.projectedRevenue),
                    }
                })
            };
        }

        // Post to Slack
        const fetch = require('node-fetch');
        const webhookUrl = process.env.SLACK_WEBHOOK_URL;
        if (!webhookUrl) {
            return { statusCode: 500, body: JSON.stringify({ error: 'SLACK_WEBHOOK_URL is not configured. Go to Netlify > Site settings > Environment variables and add it.' }) };
        }

        const slackRes = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: message }),
        });

        if (!slackRes.ok) {
            const slackBody = await slackRes.text();
            throw new Error(`Slack webhook failed (${slackRes.status}): ${slackBody}`);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                mode,
                message: 'Posted to Slack successfully!',
            })
        };

    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
