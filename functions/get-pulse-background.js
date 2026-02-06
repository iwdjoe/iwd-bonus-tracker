// update-pulse-background.js
// Runs as a Netlify Background Function
// Fetches data from Teamwork and saves it to GitHub

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN;
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";
    const BRANCH = "main"; // Assuming main branch
    const FILE_PATH = "public/data.json";

    if (!TOKEN || !GH_TOKEN) {
        console.error("Missing environment variables");
        return { statusCode: 500, body: "Missing env vars" };
    }

    try {
        console.log("--- STARTING BACKGROUND SYNC ---");
        
        // 1. DATES: Last 45 Days
        const now = new Date();
        const fetchStart = new Date(now);
        fetchStart.setDate(now.getDate() - 45); // 45 days back
        const fetchEnd = new Date(now);
        fetchEnd.setDate(now.getDate() + 1);
        
        const formatDate = (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${y}${m}${day}`;
        };

        const startStr = formatDate(fetchStart);
        const endStr = formatDate(fetchEnd);
        
        // 2. FETCH RATES (From GitHub)
        console.log('Fetching rates...');
        let rates = {};
        let globalRate = 155;
        try {
            const ratesRes = await fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { 
                headers: { 
                    "Authorization": `token ${GH_TOKEN}`, 
                    "Accept": "application/vnd.github.v3.raw" 
                } 
            });
            if (ratesRes.ok) {
                rates = await ratesRes.json();
                globalRate = rates['__GLOBAL_RATE__'] || 155;
            }
        } catch (e) {
            console.error('Error fetching rates:', e);
        }

        // 3. FETCH TIME ENTRIES (Pagination Loop)
        let allEntries = [];
        let page = 1;
        let hasMore = true;
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');

        while (hasMore) {
            console.log(`Fetching page ${page}...`);
            const url = `https://${DOMAIN}/time_entries.json?page=${page}&pageSize=500&fromDate=${startStr}&toDate=${endStr}`;
            try {
                const res = await fetch(url, { headers: { 'Authorization': AUTH } });
                if (!res.ok) throw new Error(`Teamwork API Error: ${res.status}`);
                
                const data = await res.json();
                const pageEntries = data['time-entries'] || [];
                
                if (pageEntries.length === 0) {
                    hasMore = false;
                } else {
                    allEntries = allEntries.concat(pageEntries);
                    page++;
                    if (page > 30) hasMore = false; // Safety limit
                }
            } catch (e) {
                console.error('Error fetching page ' + page, e);
                hasMore = false;
            }
        }
        
        console.log(`Total raw entries: ${allEntries.length}`);

        // 4. PROCESS DATA
        const cleanEntries = allEntries.map(e => {
            const user = (e['person-first-name'] + ' ' + e['person-last-name']).trim();
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            
            // Flags
            const isIsah = user.match(/Isah/i) && user.match(/Ramos/i);
            const isInternal = e['project-name'].match(/IWD|Runners|Dominate/i);
            
            return {
                u: user,
                p: e['project-name'],
                pid: e['project-name'].replace(/[^a-z0-9]/gi, ''),
                d: e.date, 
                h: hours,
                b: e['isbillable'] === '1',
                i: !!isInternal, 
                x: !!isIsah      
            };
        }).filter(e => e.h > 0);

        const finalData = {
            meta: {
                generated: new Date().toISOString(),
                count: cleanEntries.length,
                version: "v200-bg"
            },
            rates: rates,
            globalRate: globalRate,
            entries: cleanEntries
        };
        
        // 5. SAVE TO GITHUB
        const content = Buffer.from(JSON.stringify(finalData, null, 2)).toString('base64');
        
        // Get SHA of existing file to update it
        let sha = "";
        try {
            const fileRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
                headers: { "Authorization": `token ${GH_TOKEN}` }
            });
            if (fileRes.ok) {
                const fileData = await fileRes.json();
                sha = fileData.sha;
            }
        } catch (e) {
            console.log("File might not exist yet, creating new.");
        }

        const body = {
            message: "Update pulse data via Background Function",
            content: content,
            branch: BRANCH
        };
        if (sha) body.sha = sha;

        const uploadRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
            method: 'PUT',
            headers: {
                "Authorization": `token ${GH_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (uploadRes.ok) {
            console.log("Successfully updated GitHub file.");
            return { statusCode: 200, body: "Updated" };
        } else {
            console.error("GitHub Upload Failed", await uploadRes.text());
            return { statusCode: 500, body: "Upload Failed" };
        }

    } catch (error) {
        console.error("CRITICAL ERROR", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
