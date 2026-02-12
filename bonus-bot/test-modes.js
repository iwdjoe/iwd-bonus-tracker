#!/usr/bin/env node

// Quick test script to verify all 3 message modes render correctly
// Uses sample data matching the brief's Feb 12 examples

require('dotenv').config({ path: __dirname + '/.env' });

const { calculateStats } = require('./lib/calculate-stats');
const { determineMode, getModeDetails } = require('./lib/determine-mode');
const { formatMessage } = require('./lib/format-message');
const { postToSlack } = require('./lib/post-slack');

const dashboardUrl = process.env.DASHBOARD_URL || 'https://your-site.netlify.app';
const timezone = process.env.TIMEZONE || 'Europe/Madrid';
const shouldPost = process.argv.includes('--post');
const webhookUrl = process.env.SLACK_TEST_WEBHOOK_URL;

// Sample API response based on the brief's Feb 12 data
function makeSampleData(revenueMultiplier) {
    const baseProjects = [
        { id: 'SchoolFix', name: 'SchoolFix', hours: 45.2, rate: 160, def: 155 },
        { id: 'InyoPools', name: 'Inyo Pools', hours: 38.5, rate: 140, def: 155 },
        { id: 'PryorSEO', name: 'Pryor SEO', hours: 32.0, rate: 155, def: 155 },
        { id: 'BinMaster', name: 'BinMaster', hours: 28.3, rate: 180, def: 155 },
        { id: 'EuropaEyewear', name: 'Europa Eyewear', hours: 22.0, rate: 140, def: 155 },
        { id: 'PurdueMaint', name: 'Purdue Maintenance', hours: 15.5, rate: 150, def: 155 },
    ];

    // Scale hours to hit the desired revenue range
    const projects = baseProjects.map(p => ({
        ...p,
        hours: +(p.hours * revenueMultiplier).toFixed(2),
    }));

    return {
        users: [
            { name: 'Oleg Sergiyenko', hours: +(40.8 * revenueMultiplier).toFixed(2) },
            { name: 'Marcos Araujo', hours: +(37.7 * revenueMultiplier).toFixed(2) },
            { name: 'Irina Lukyanchuk', hours: +(32.5 * revenueMultiplier).toFixed(2) },
            { name: 'Victor Gomez', hours: +(25.2 * revenueMultiplier).toFixed(2) },
            { name: 'Ana Rodriguez', hours: +(20.1 * revenueMultiplier).toFixed(2) },
            { name: 'Carlos Mendez', hours: +(15.8 * revenueMultiplier).toFixed(2) },
            { name: 'Sara Kim', hours: +(9.4 * revenueMultiplier).toFixed(2) },
        ],
        projects,
        meta: {
            serverTime: new Date().toISOString(),
            globalRate: 155,
            cached: false,
            month: new Date().toISOString().slice(0, 7),
            isCurrentMonth: true,
        },
    };
}

async function testMode(label, multiplier, forceMode) {
    const data = makeSampleData(multiplier);
    const stats = calculateStats(data, timezone);
    const mode = forceMode || determineMode(stats.projectedRevenue);
    const modeDetails = getModeDetails(mode, stats);
    const message = formatMessage(stats, mode, modeDetails, dashboardUrl);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${label} (${mode.toUpperCase()} MODE)`);
    console.log(`  Projected: $${Math.round(stats.projectedRevenue).toLocaleString('en-US')}`);
    console.log(`${'='.repeat(60)}\n`);
    console.log(message);
    console.log('');

    if (shouldPost && webhookUrl) {
        console.log(`  -> Posting to Slack test channel...`);
        await postToSlack(webhookUrl, message);
        console.log(`  -> Posted!`);
        // Small delay between posts to avoid rate limiting
        await new Promise(r => setTimeout(r, 1500));
    }
}

async function main() {
    console.log('IWD Bonus Bot — Mode Preview Test');
    console.log(`Timezone: ${timezone}`);

    if (shouldPost && !webhookUrl) {
        console.error('Error: SLACK_TEST_WEBHOOK_URL not set. Cannot --post.');
        process.exit(1);
    }

    if (shouldPost) {
        console.log('Will post each message to Slack test channel.');
    }

    // Yellow mode (current state — projected ~$72k)
    await testMode('YELLOW — Within Striking Distance', 1.0, 'yellow');

    // Green mode (projected ~$105k)
    await testMode('GREEN — On Track for Bonus', 1.5, 'green');

    // Red mode (projected ~$55k)
    await testMode('RED — Below Threshold', 0.7, 'red');

    // Green Top Tier (projected ~$170k)
    await testMode('GREEN TOP TIER — Maxed Out', 2.4, 'green');

    console.log('\nAll modes rendered successfully.');
    if (!shouldPost) {
        console.log('Run with --post to send these to your Slack test channel.');
    }
}

main();
