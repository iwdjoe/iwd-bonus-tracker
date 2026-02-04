const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // AUTH
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";
    const PATH = "rates.json";
    
    try {
        const body = JSON.parse(event.body);
        const { projectId, rate } = body; // expecting ID or Name

        if (!projectId || !rate) return { statusCode: 400, body: "Missing Data" };

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
        currentRates[projectId] = parseInt(rate);

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