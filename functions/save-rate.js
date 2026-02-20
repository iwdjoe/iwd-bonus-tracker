const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // ── Authentication ────────────────────────────────────────────────────────
    const user = context.clientContext && context.clientContext.user;

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

        // 1. Get Current File (Need SHA to update)
        const getUrl = `https://api.github.com/repos/${REPO}/contents/${PATH}`;
        const currentFile = await fetch(getUrl, {
            headers: { 
                "Authorization": `token ${GH_TOKEN}`,
                "Accept": "application/vnd.github.v3+json"
            }
        }).then(res => res.json());

        // 2. Decode Content
        let currentRates = {};
        if (currentFile.content) {
            const buff = Buffer.from(currentFile.content, 'base64');
            currentRates = JSON.parse(buff.toString('utf-8'));
        }

        // 3. Update Rate
        currentRates[projectId] = parsedRate;

        // 4. Commit Back
        const newContent = Buffer.from(JSON.stringify(currentRates, null, 2)).toString('base64');
        
        const updateRes = await fetch(getUrl, {
            method: 'PUT',
            headers: { 
                "Authorization": `token ${GH_TOKEN}`,
                "Accept": "application/vnd.github.v3+json"
            },
            body: JSON.stringify({
                message: `Update rate for ${projectId} to $${rate}`,
                content: newContent,
                sha: currentFile.sha
            })
        });

        if (!updateRes.ok) throw new Error("GitHub Update Failed");

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, rates: currentRates })
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};