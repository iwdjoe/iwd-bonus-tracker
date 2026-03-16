// Scheduled Slack Bonus Update — runs Mon & Thu at 10am Madrid time
// Cron schedule configured in netlify.toml
// Reuses send-slack handler with auto mode

const fetch = require('node-fetch');
const sendSlack = require('./send-slack');

const GH_TOKEN = process.env.GITHUB_PAT;
const REPO = 'iwdjoe/iwd-bonus-tracker';
const STATE_PATH = 'slack-cron-state.json';
const STATE_URL = `https://api.github.com/repos/${REPO}/contents/${STATE_PATH}`;
const DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

async function getLastSent() {
    try {
        const res = await fetch(STATE_URL, {
            headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github.v3.raw' }
        });
        if (!res.ok) return { lastSent: null, sha: null };
        const data = await res.json();
        // Re-fetch with json+json to get sha
        const metaRes = await fetch(STATE_URL, {
            headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
        });
        const meta = await metaRes.json();
        return { lastSent: data.lastSent || null, sha: meta.sha || null };
    } catch (_) {
        return { lastSent: null, sha: null };
    }
}

async function setLastSent(sha) {
    const content = Buffer.from(JSON.stringify({ lastSent: new Date().toISOString() }, null, 2)).toString('base64');
    const body = { message: 'Update slack-cron last sent timestamp', content, ...(sha ? { sha } : {}) };
    await fetch(STATE_URL, {
        method: 'PUT',
        headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
        body: JSON.stringify(body)
    });
}

exports.handler = async function(event) {
    // ── Dedup guard: skip if already posted within the last 10 minutes ──────
    const { lastSent, sha } = await getLastSent();
    if (lastSent) {
        const elapsed = Date.now() - new Date(lastSent).getTime();
        if (elapsed < DEDUP_WINDOW_MS) {
            console.log(`[slack-cron] skipped — already sent ${Math.round(elapsed / 1000)}s ago`);
            return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'dedup' }) };
        }
    }

    // ── Mark as sent before posting to block any near-simultaneous duplicate ─
    await setLastSent(sha);

    const result = await sendSlack.handler({
        httpMethod: 'POST',
        headers: { 'x-cron-secret': process.env.CRON_SECRET || '' },
        body: JSON.stringify({ mode: 'auto' })
    }, {});

    console.log('[slack-cron]', result.statusCode, result.body);
    return result;
};
