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

// Work-day window: starts 9:00 on the team clock, ENDS 12:00 PM US Central.
// The end is anchored to Central (not hardcoded as a team-clock hour) so it stays
// correct when either zone shifts for daylight saving.
const WORK_END_TIMEZONE = 'America/Chicago';
const WORK_START_HOUR = 9;
const WORK_END_HOUR_CENTRAL = 12;

function getHourDecimalInZone(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(date);
    const p = {};
    parts.forEach(part => { if (part.type !== 'literal') p[part.type] = part.value; });
    let hour = parseInt(p.hour, 10);
    if (hour === 24) hour = 0;
    return hour + parseInt(p.minute, 10) / 60;
}

/**
 * Noon Central expressed as an hour on the team clock (e.g. 19.0 in Warsaw while
 * Central runs 7 hours behind).
 */
function getWorkEndHourTeamTime(timezone) {
    const instant = new Date();
    let offset = getHourDecimalInZone(instant, timezone) - getHourDecimalInZone(instant, WORK_END_TIMEZONE);
    if (offset > 12) offset -= 24;
    if (offset < -12) offset += 24;
    return WORK_END_HOUR_CENTRAL + offset;
}

/**
 * Fraction of today's work day elapsed, 0 to 1, by clock time.
 */
function getWorkDayFractionByClock(now, timezone) {
    const hourDecimal = now.getHours() + now.getMinutes() / 60;
    const span = Math.max(getWorkEndHourTeamTime(timezone) - WORK_START_HOUR, 0.5);
    return Math.max(0, Math.min((hourDecimal - WORK_START_HOUR) / span, 1));
}

/**
 * Count business days (Mon-Fri) between two dates, inclusive
 */
function getWorkDays(start, end) {
    // Use UTC to avoid DST boundary issues (spring-forward can shift
    // the hour on setDate, causing the final day comparison to miss a day)
    const msPerDay = 86400000;
    const s = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const e = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    let count = 0;
    for (let t = s; t <= e; t += msPerDay) {
        const day = new Date(t).getUTCDay();
        if (day !== 0 && day !== 6) count++;
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

    // Timezone-neutral projection: use actual hours logged today vs daily average
    const projects = data.projects || [];
    const users = (data.users || []).filter(u => u.name && u.name.trim() !== '');
    const globalRate = (data.meta && data.meta.globalRate) || 155;
    const todayHours = (data.meta && data.meta.todayBillableHours) || 0;

    const currentRevenue = projects.reduce((sum, p) => sum + (p.hours * p.rate), 0);
    const totalBillableHours = projects.reduce((sum, p) => sum + p.hours, 0);

    const isWeekday = (now.getDay() !== 0 && now.getDay() !== 6);
    const yesterday = new Date(year, month, now.getDate() - 1);
    const completedDays = getWorkDays(monthStart, yesterday);
    let currentWorkDay;

    if (isWeekday && completedDays > 0) {
        let todayFraction;
        if (todayHours > 0) {
            const priorDaysHours = totalBillableHours - todayHours;
            const avgDailyHours = priorDaysHours / completedDays;
            todayFraction = avgDailyHours > 0 ? Math.min(todayHours / avgDailyHours, 1) : 0;
        } else {
            // Fallback: use time-of-day when no hours logged yet today
            todayFraction = getWorkDayFractionByClock(now, timezone);
        }
        currentWorkDay = completedDays + todayFraction;
    } else {
        currentWorkDay = Math.max(completedDays, 1);
    }

    const daysRemaining = Math.max(totalWorkDays - currentWorkDay, 0);

    const projectedRevenue = currentWorkDay > 0
        ? (currentRevenue / currentWorkDay) * totalWorkDays
        : 0;

    // Team leaderboard sorted by hours, with share percentages
    // Contractors are excluded from bonus payout calculations
    const bonusEligible = users.filter(u => !u.contractor);
    const totalUserHours = bonusEligible.reduce((sum, u) => sum + u.hours, 0);
    const leaderboard = bonusEligible
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
