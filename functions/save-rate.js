const { readRates, writeRates } = require('./_lib/rates-store');

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

    try {
        const body = JSON.parse(event.body);
        const { projectId, rate } = body;

        if (!projectId || rate === undefined) return { statusCode: 400, body: JSON.stringify({ error: "Missing projectId or rate" }) };

        // Validate projectId: alphanumeric + hyphens/underscores only, block prototype pollution keys
        const BLOCKED_KEYS = ['__proto__', 'constructor', 'prototype'];
        if (!/^[a-zA-Z0-9_-]+$/.test(projectId) && projectId !== '__GLOBAL_RATE__') {
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid projectId" }) };
        }
        if (BLOCKED_KEYS.includes(projectId)) {
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid projectId" }) };
        }

        // Validate rate: must be a positive integer between 1 and 9999
        const parsedRate = parseInt(rate, 10);
        if (isNaN(parsedRate) || parsedRate < 1 || parsedRate > 9999) {
            return { statusCode: 400, body: JSON.stringify({ error: "Rate must be a number between 1 and 9999" }) };
        }

        const currentRates = await readRates();
        currentRates[projectId] = parsedRate;
        await writeRates(currentRates);

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, rates: currentRates })
        };

    } catch (error) {
        console.error('save-rate error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
