const fetch = require('node-fetch');

// ── Rate Limiter (10 requests/min per IP) ───────────────────────────────────
const rateLimitMap = {};
function isRateLimited(ip, limit = 10, windowMs = 60000) {
    const now = Date.now();
    if (!rateLimitMap[ip] || now - rateLimitMap[ip].start > windowMs) {
        rateLimitMap[ip] = { count: 1, start: now };
        return false;
    }
    rateLimitMap[ip].count++;
    return rateLimitMap[ip].count > limit;
}
// ────────────────────────────────────────────────────────────────────────────

exports.handler = async function(event, context) {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }, body: '' };
    }

    if (event.httpMethod !== 'POST') {
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

    const ip = (event.headers && (event.headers['x-forwarded-for'] || event.headers['client-ip'])) || 'unknown';
    if (isRateLimited(ip)) {
        return { statusCode: 429, body: JSON.stringify({ error: 'Too many requests. Please wait a moment.' }) };
    }

    const GH_TOKEN = process.env.GITHUB_PAT;
    const REPO = 'iwdjoe/iwd-bonus-tracker';
    const PATH = 'velocity-data.json';

    try {
        const body = JSON.parse(event.body);
        const { config, status } = body;

        if (!config || typeof config !== 'object') {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid config object' }) };
        }
        if (!status || typeof status !== 'object') {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid status object' }) };
        }

        // Validate config entries
        const BLOCKED_KEYS = ['__proto__', 'constructor', 'prototype'];
        for (const [key, val] of Object.entries(config)) {
            if (BLOCKED_KEYS.includes(key)) {
                return { statusCode: 400, body: JSON.stringify({ error: 'Invalid client name: ' + key }) };
            }
            if (typeof val !== 'object' || val === null) {
                return { statusCode: 400, body: JSON.stringify({ error: 'Invalid config for: ' + key }) };
            }
            // Sanitize values
            config[key] = {
                plan: typeof val.plan === 'string' ? val.plan.slice(0, 50) : '',
                rate: typeof val.rate === 'number' && val.rate >= 1 && val.rate <= 9999 ? Math.round(val.rate) : null,
                minHours: typeof val.minHours === 'number' && val.minHours >= 0 && val.minHours <= 999 ? val.minHours : 0,
                plannedHours: typeof val.plannedHours === 'number' && val.plannedHours >= 0 && val.plannedHours <= 9999 ? val.plannedHours : 0
            };
        }

        // Validate status entries (string values, max 200 chars)
        for (const [key, val] of Object.entries(status)) {
            if (BLOCKED_KEYS.includes(key)) {
                return { statusCode: 400, body: JSON.stringify({ error: 'Invalid client name: ' + key }) };
            }
            status[key] = typeof val === 'string' ? val.slice(0, 200) : '';
        }

        // 1. Get current file SHA
        const getUrl = `https://api.github.com/repos/${REPO}/contents/${PATH}`;
        const currentFile = await fetch(getUrl, {
            headers: {
                'Authorization': `token ${GH_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        }).then(r => r.json());

        const sha = currentFile.sha || null;

        // 2. Build new content
        const data = { config, status };
        const newContent = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');

        // 3. Commit to GitHub
        const putBody = {
            message: `Update velocity config (${email})`,
            content: newContent
        };
        if (sha) putBody.sha = sha;

        const putRes = await fetch(getUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GH_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify(putBody)
        });

        if (!putRes.ok) {
            const errBody = await putRes.text();
            throw new Error('GitHub update failed: ' + putRes.status + ' ' + errBody);
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true })
        };

    } catch (error) {
        console.error('save-velocity-config error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
