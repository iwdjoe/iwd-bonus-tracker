const fetch = require('node-fetch');

// ── Rate Limiter (10 requests/min per IP) ─────────────────────────────────────
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
// ─────────────────────────────────────────────────────────────────────────────

exports.handler = async function(event, context) {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // ── Authentication ────────────────────────────────────────────────────────
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
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Unauthorized: login required' })
        };
    }

    const email = (user.email || '').toLowerCase();
    if (!email.endsWith('@iwdagency.com')) {
        return {
            statusCode: 403,
            body: JSON.stringify({ error: 'Forbidden: @iwdagency.com account required' })
        };
    }
    // ─────────────────────────────────────────────────────────────────────────

    const ip = (event.headers && (event.headers['x-forwarded-for'] || event.headers['client-ip'])) || 'unknown';
    if (isRateLimited(ip)) {
        return { statusCode: 429, body: JSON.stringify({ error: 'Too many requests. Please wait a moment.' }) };
    }

    const GH_TOKEN = process.env.GITHUB_PAT;
    const REPO = "iwdjoe/iwd-bonus-tracker";
    const PATH = "rates.json";
    
    try {
        const body = JSON.parse(event.body);
        const { projectId, rate } = body;

        if (!projectId || rate === undefined) return { statusCode: 400, body: JSON.stringify({ error: "Missing projectId or rate" }) };

        // Validate projectId: alphanumeric + hyphens/underscores only, block prototype pollution keys
        const BLOCKED_KEYS = ['__proto__', 'constructor', 'prototype', '__GLOBAL_RATE__'];
        if (!/^[a-zA-Z0-9_-]+$/.test(projectId) || BLOCKED_KEYS.includes(projectId)) {
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid projectId" }) };
        }

        // Validate rate: must be a positive integer between 1 and 9999
        const parsedRate = parseInt(rate, 10);
        if (isNaN(parsedRate) || parsedRate < 1 || parsedRate > 9999) {
            return { statusCode: 400, body: JSON.stringify({ error: "Rate must be a number between 1 and 9999" }) };
        }

        const getUrl = `https://api.github.com/repos/${REPO}/contents/${PATH}`;

        async function readCurrent() {
            const res = await fetch(getUrl, {
                headers: {
                    "Authorization": `token ${GH_TOKEN}`,
                    "Accept": "application/vnd.github.v3+json"
                }
            });
            if (res.status === 404) return { rates: {}, sha: null };
            if (!res.ok) {
                const errBody = await res.text();
                throw new Error('GitHub GET failed: ' + res.status + ' ' + errBody);
            }
            const data = await res.json();
            const rates = data.content
                ? JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'))
                : {};
            return { rates, sha: data.sha || null };
        }

        async function commit(rates, sha) {
            const newContent = Buffer.from(JSON.stringify(rates, null, 2)).toString('base64');
            const putBody = {
                message: `Update rate for ${projectId} to $${parsedRate}`,
                content: newContent
            };
            if (sha) putBody.sha = sha;
            return fetch(getUrl, {
                method: 'PUT',
                headers: {
                    "Authorization": `token ${GH_TOKEN}`,
                    "Accept": "application/vnd.github.v3+json"
                },
                body: JSON.stringify(putBody)
            });
        }

        // 1. Read current rates + SHA
        let { rates: currentRates, sha } = await readCurrent();

        // 2. Apply update
        currentRates[projectId] = parsedRate;

        // 3. Commit (retry once on 409 Conflict — stale SHA)
        let updateRes = await commit(currentRates, sha);
        if (updateRes.status === 409) {
            const retry = await readCurrent();
            retry.rates[projectId] = parsedRate;
            currentRates = retry.rates;
            updateRes = await commit(retry.rates, retry.sha);
        }

        if (!updateRes.ok) {
            const errBody = await updateRes.text();
            console.error('save-rate GitHub error:', updateRes.status, errBody);
            throw new Error('GitHub update failed: ' + updateRes.status + ' ' + errBody);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, rates: currentRates })
        };

    } catch (error) {
        console.error('save-rate error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};