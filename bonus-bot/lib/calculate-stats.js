// Computes derived metrics from raw API data
// Replicates the calculation logic from index.html (calc function)

/**
 * Get current date/time in a specific timezone (safe cross-platform approach)
 */
function getTimezoneNow(timezone) {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
    const parts = {};
    formatter.formatToParts(now).forEach(({ type, value }) => {
        parts[type] = value;
    });
    return new Date(
        parseInt(parts.year),
        parseInt(parts.month) - 1,
        parseInt(parts.day),
        parseInt(parts.hour),
        parseInt(parts.minute),
        parseInt(parts.second)
    );
}

/**
 * Count business days (Mon-Fri) between two dates, inclusive
 */
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

/**
 * Calculate all derived stats from raw API response
 */
function calculateStats(data, timezone) {
    const now = getTimezoneNow(timezone);
    const year = now.getFullYear();
    const month = now.getMonth();

    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);

    const totalWorkDays = getWorkDays(monthStart, monthEnd);
    let currentWorkDay = getWorkDays(monthStart, now);

    // Match frontend logic: only count today as "done" if it's after 5 PM
    if (now.getHours() < 17) {
        currentWorkDay = Math.max(currentWorkDay - 1, 1);
    }

    const daysRemaining = Math.max(totalWorkDays - currentWorkDay, 0);

    const projects = data.projects || [];
    const users = (data.users || []).filter(u => u.name && u.name.trim() !== '');
    const globalRate = (data.meta && data.meta.globalRate) || 155;

    // Revenue = sum(hours * rate) for each billable project
    // The API already filters for billable-only, non-internal projects
    const currentRevenue = projects.reduce((sum, p) => sum + (p.hours * p.rate), 0);

    // Projected revenue = extrapolate current pace across the full month
    const projectedRevenue = currentWorkDay > 0
        ? (currentRevenue / currentWorkDay) * totalWorkDays
        : 0;

    // Total billable hours (from projects, not users — users include all hours)
    const totalBillableHours = projects.reduce((sum, p) => sum + p.hours, 0);

    // Team leaderboard sorted by hours, with share percentages
    const totalUserHours = users.reduce((sum, u) => sum + u.hours, 0);
    const leaderboard = users
        .sort((a, b) => b.hours - a.hours)
        .map(u => ({
            name: u.name,
            hours: u.hours,
            sharePct: totalUserHours > 0 ? (u.hours / totalUserHours) * 100 : 0,
        }));

    // Active members = anyone who has logged hours
    const activeMembers = users.filter(u => u.hours > 0).length;

    return {
        currentRevenue,
        projectedRevenue,
        currentWorkDay,
        totalWorkDays,
        daysRemaining,
        totalBillableHours,
        globalRate,
        leaderboard,
        activeMembers,
        date: now,
    };
}

module.exports = { calculateStats, getWorkDays, getTimezoneNow };
