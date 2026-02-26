const fetch = require('node-fetch');

// ── In-memory cache ─────────────────────────────────────────────────────────
let cache = { data: null, ts: 0 };
const CACHE_TTL = 15000; // 15 seconds — short so edits propagate quickly

exports.handler = async function(event, context) {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // ── Authentication ──────────────────────────────────────────────────────
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
        return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized: login required' }) };
    }

    const email = (user.email || '').toLowerCase();
    if (!email.endsWith('@iwdagency.com')) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: @iwdagency.com account required' }) };
    }
    // ────────────────────────────────────────────────────────────────────────

    // Return from cache if fresh
    const now = Date.now();
    if (cache.data && (now - cache.ts) < CACHE_TTL) {
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cache.data)
        };
    }

    const GH_TOKEN = process.env.GITHUB_PAT;
    const REPO = 'iwdjoe/iwd-bonus-tracker';
    const PATH = 'velocity-data.json';

    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${PATH}`, {
            headers: {
                'Authorization': `token ${GH_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!res.ok) {
            // File doesn't exist yet — return empty defaults
            if (res.status === 404) {
                const empty = { config: {}, status: {} };
                cache = { data: empty, ts: now };
                return {
                    statusCode: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(empty)
                };
            }
            throw new Error('GitHub API error: ' + res.status);
        }

        const file = await res.json();
        const content = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));

        // Ensure structure
        const data = {
            config: content.config || {},
            status: content.status || {}
        };

        cache = { data, ts: now };

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        };

    } catch (error) {
        console.error('get-velocity-config error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
