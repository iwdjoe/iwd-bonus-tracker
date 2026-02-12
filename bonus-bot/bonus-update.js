#!/usr/bin/env node

// IWD Bonus Bot — Slack Team Update Script
// Usage:
//   node bonus-update.js              Post to main Slack channel
//   node bonus-update.js --dry-run    Preview message in terminal (no Slack post)
//   node bonus-update.js --test       Post to test webhook instead of main
//   node bonus-update.js --mode green Force a specific mode (green/yellow/red)
//   node bonus-update.js --help       Show usage info

require('dotenv').config({ path: __dirname + '/.env' });

const { fetchDashboardData } = require('./lib/fetch-data');
const { calculateStats } = require('./lib/calculate-stats');
const { determineMode, getModeDetails } = require('./lib/determine-mode');
const { formatMessage } = require('./lib/format-message');
const { postToSlack } = require('./lib/post-slack');

function showHelp() {
    console.log(`
IWD Bonus Bot — Slack Team Update

Usage:
  node bonus-update.js [options]

Options:
  --dry-run          Preview the formatted message without posting to Slack
  --test             Post to SLACK_TEST_WEBHOOK_URL instead of the main webhook
  --mode <mode>      Force a mode: green, yellow, or red (uses real data, overrides auto-detection)
  --help             Show this help message

Schedule (cron):
  Monday 9:00 AM CET    0 9 * * 1
  Thursday 2:00 PM CET  0 14 * * 4

Environment (.env):
  SLACK_WEBHOOK_URL       Main Slack channel webhook
  SLACK_TEST_WEBHOOK_URL  Test/DM webhook for previewing
  DASHBOARD_API_URL       Netlify API endpoint (e.g. https://your-site.netlify.app/api/get-stats)
  DASHBOARD_URL           Public dashboard link for the team
  TIMEZONE                Timezone for date calculations (default: Europe/Madrid)
`);
}

async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help')) {
        showHelp();
        process.exit(0);
    }

    const isDryRun = args.includes('--dry-run');
    const isTest = args.includes('--test');
    const modeIndex = args.indexOf('--mode');
    const modeFlag = modeIndex !== -1 ? args[modeIndex + 1] : null;

    // Validate --mode flag
    if (modeFlag && !['green', 'yellow', 'red'].includes(modeFlag)) {
        console.error(`Error: Invalid mode "${modeFlag}". Use green, yellow, or red.`);
        process.exit(1);
    }

    const apiUrl = process.env.DASHBOARD_API_URL;
    const dashboardUrl = process.env.DASHBOARD_URL || 'https://your-site.netlify.app';
    const timezone = process.env.TIMEZONE || 'Europe/Madrid';
    const webhookUrl = isTest
        ? process.env.SLACK_TEST_WEBHOOK_URL
        : process.env.SLACK_WEBHOOK_URL;

    if (!apiUrl) {
        console.error('Error: DASHBOARD_API_URL is not set. Check your .env file.');
        process.exit(1);
    }

    if (!isDryRun && !webhookUrl) {
        const varName = isTest ? 'SLACK_TEST_WEBHOOK_URL' : 'SLACK_WEBHOOK_URL';
        console.error(`Error: ${varName} is not set. Check your .env file.`);
        process.exit(1);
    }

    try {
        // 1. Fetch data from the dashboard API
        console.log('Fetching dashboard data...');
        const data = await fetchDashboardData(apiUrl);

        // 2. Calculate derived metrics
        console.log('Calculating stats...');
        const stats = calculateStats(data, timezone);

        // 3. Determine mode (auto or forced)
        let mode;
        if (modeFlag) {
            mode = modeFlag;
            console.log(`Mode: ${mode.toUpperCase()} (forced via --mode)`);
        } else {
            mode = determineMode(stats.projectedRevenue);
            console.log(`Mode: ${mode.toUpperCase()} (auto-detected)`);
        }

        // 4. Build the message
        const modeDetails = getModeDetails(mode, stats);
        const message = formatMessage(stats, mode, modeDetails, dashboardUrl);

        // 5. Log summary
        console.log('');
        console.log('--- Stats Summary ---');
        console.log(`  Revenue:       $${Math.round(stats.currentRevenue).toLocaleString('en-US')}`);
        console.log(`  Projected:     $${Math.round(stats.projectedRevenue).toLocaleString('en-US')}`);
        console.log(`  Work Day:      ${stats.currentWorkDay} of ${stats.totalWorkDays} (${stats.daysRemaining} remaining)`);
        console.log(`  Billable Hrs:  ${stats.totalBillableHours.toFixed(1)}`);
        console.log(`  Team Members:  ${stats.activeMembers} active`);
        console.log(`  Mode:          ${mode.toUpperCase()}`);
        console.log('');

        // 6. Post or preview
        if (isDryRun) {
            console.log('--- Slack Message Preview ---');
            console.log(message);
            console.log('--- End Preview ---');
            console.log('');
            console.log('(Dry run — message was NOT posted to Slack)');
        } else {
            const target = isTest ? 'test channel' : 'main channel';
            console.log(`Posting to Slack (${target})...`);
            await postToSlack(webhookUrl, message);
            console.log('Message posted successfully!');
        }

    } catch (error) {
        console.error('');
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

main();
