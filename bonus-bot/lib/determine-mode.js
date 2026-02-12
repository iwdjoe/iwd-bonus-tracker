// Determines message mode (green/yellow/red) and computes mode-specific details
// Tier thresholds match the getPool() function in index.html

const BONUS_TIERS = [
    { threshold: 160000, pool: 6000, label: 'Top Tier' },
    { threshold: 145000, pool: 5000, label: 'Tier 5' },
    { threshold: 130000, pool: 4000, label: 'Tier 4' },
    { threshold: 115000, pool: 3000, label: 'Tier 3' },
    { threshold: 100000, pool: 2000, label: 'Tier 2' },
    { threshold: 85000,  pool: 1000, label: 'Tier 1' },
];

/**
 * Get the bonus pool for a given revenue (matches frontend getPool)
 */
function getPool(rev) {
    for (const tier of BONUS_TIERS) {
        if (rev >= tier.threshold) return tier.pool;
    }
    return 0;
}

/**
 * Get the tier label for a given revenue
 */
function getTierLabel(rev) {
    for (const tier of BONUS_TIERS) {
        if (rev >= tier.threshold) return tier.label;
    }
    return 'Baseline';
}

/**
 * Determine which message mode to use based on projected revenue
 *   green:  on track for a bonus (projected >= $85k)
 *   yellow: within striking distance (projected >= $68k)
 *   red:    below $68k — focus on effort, skip bonus framing
 */
function determineMode(projectedRevenue) {
    const BONUS_THRESHOLD = 85000;
    const YELLOW_THRESHOLD = BONUS_THRESHOLD * 0.8; // $68,000

    if (projectedRevenue >= BONUS_THRESHOLD) return 'green';
    if (projectedRevenue >= YELLOW_THRESHOLD) return 'yellow';
    return 'red';
}

/**
 * Compute mode-specific details for the message template
 */
function getModeDetails(mode, stats) {
    const { projectedRevenue, daysRemaining, activeMembers, globalRate } = stats;

    if (mode === 'green') {
        const pool = getPool(projectedRevenue);
        const tierLabel = getTierLabel(projectedRevenue);
        const isTopTier = projectedRevenue >= 160000;

        // Find the next tier above current projected revenue
        const nextTier = [...BONUS_TIERS].reverse().find(t => t.threshold > projectedRevenue);

        return {
            pool,
            tierLabel,
            isTopTier,
            nextTierPool: nextTier ? nextTier.pool : null,
            gapToNextTier: nextTier ? nextTier.threshold - projectedRevenue : 0,
        };
    }

    if (mode === 'yellow') {
        const gapTo85k = 85000 - projectedRevenue;
        const additionalHours = gapTo85k / globalRate;
        const hoursPerPersonPerDay =
            activeMembers > 0 && daysRemaining > 0
                ? additionalHours / activeMembers / daysRemaining
                : 0;

        return {
            gapTo85k,
            additionalHours,
            hoursPerPersonPerDay,
        };
    }

    // Red mode — no bonus-specific details
    return {};
}

module.exports = { determineMode, getModeDetails, getPool, getTierLabel, BONUS_TIERS };
