// GET PULSE (READ-ONLY)
// Reads pulse-cache.json from GitHub Raw.
// Fast. Reliable. No Timeouts.

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";

    try {
        // USE GITHUB API (Reliable for Private Repos)
        const res = await fetch(`https://api.github.com/repos/${REPO}/contents/pulse-cache.json`, {
            headers: { 
                "Authorization": `token ${GH_TOKEN}`,
                "Accept": "application/vnd.github.v3.raw" // Returns raw file content
            }
        });
        
        if (!res.ok) throw new Error(`GitHub API Error: ${res.status}`);
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