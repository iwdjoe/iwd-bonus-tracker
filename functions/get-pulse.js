// GET PULSE (READ-ONLY)
// Reads pulse-cache.json from GitHub Raw.
// Fast. Reliable. No Timeouts.

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";

    try {
        // Read Raw from GitHub (add timestamp to bust CDN cache)
        const res = await fetch(`https://raw.githubusercontent.com/${REPO}/main/pulse-cache.json?v=${Date.now()}`, {
            headers: { "Authorization": `token ${GH_TOKEN}` }
        });
        
        if (!res.ok) throw new Error("Cache Read Failed");
        const data = await res.json();

        return { 
            statusCode: 200, 
            body: JSON.stringify(data),
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            }
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};