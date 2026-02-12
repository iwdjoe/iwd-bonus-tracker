// Builds the formatted Slack message using mrkdwn syntax
// Formatting rules: commas in currency, 1 decimal for hours/%, Slack link format

function formatCurrency(num) {
    return '$' + Math.round(num).toLocaleString('en-US');
}

function formatHours(num) {
    return num.toFixed(1);
}

function formatPct(num) {
    return num.toFixed(1);
}

const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}']; // 🥇 🥈 🥉

/**
 * Build the full Slack message for a given mode
 */
function formatMessage(stats, mode, modeDetails, dashboardUrl) {
    const {
        date, currentRevenue, projectedRevenue,
        currentWorkDay, totalWorkDays, daysRemaining,
        totalBillableHours, leaderboard,
    } = stats;

    // Date formatting
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dayName = dayNames[date.getDay()];
    const monthName = monthNames[date.getMonth()];
    const dayNum = date.getDate();

    const lines = [];

    // ── Header ──
    lines.push(`\u{1F680} *Team Bonus Update* \u2014 ${dayName}, ${monthName} ${dayNum}`);
    lines.push('');

    // ── Mode-specific header ──
    if (mode === 'green') {
        lines.push(`\u{1F4B0} *We're on track for a ${formatCurrency(modeDetails.pool)} bonus pool!* (${modeDetails.tierLabel})`);
    } else if (mode === 'yellow') {
        lines.push(`\u26A1 *${formatCurrency(modeDetails.gapTo85k)} away from unlocking a $1,000 bonus pool*`);
    } else {
        lines.push(`\u{1F4CA} *Here's where we stand this month*`);
    }
    lines.push('');

    // ── Core stats ──
    lines.push(`\u{1F4CA} *Revenue:* ${formatCurrency(currentRevenue)} current \u2192 ${formatCurrency(projectedRevenue)} projected`);
    lines.push(`\u23F3 *Day ${currentWorkDay} of ${totalWorkDays}* \u2014 ${daysRemaining} days remaining`);
    lines.push(`\u{1F550} *Billable Hours:* ${formatHours(totalBillableHours)} hrs logged`);
    lines.push('');

    // ── Leaderboard (top 3 or fewer) ──
    const topN = Math.min(leaderboard.length, 3);
    if (topN > 0) {
        lines.push(`\u{1F3C6} *Top Contributors:*`);
        for (let i = 0; i < topN; i++) {
            const { name, hours, sharePct } = leaderboard[i];
            lines.push(`${MEDALS[i]} ${name} \u2014 ${formatHours(hours)} hrs (${formatPct(sharePct)}%)`);
        }
        lines.push('');
    }

    // ── Mode-specific insight ──
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

    // ── Dashboard link ──
    lines.push(`\u{1F449} <${dashboardUrl}|View Live Dashboard>`);

    return lines.join('\n');
}

module.exports = { formatMessage, formatCurrency, formatHours, formatPct };
