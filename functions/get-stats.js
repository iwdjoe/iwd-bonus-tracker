exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    
    // --- GITHUB DB CONFIG ---
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";
    const PATH = "rates.json";
    // ------------------------

    // Auth Check
    if (!TOKEN) return { statusCode: 500, body: JSON.stringify({ error: "Missing Token" }) };

    const authHeader = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    const fromDate = startOfMonth.replace(/-/g, '');
    const toDate = endOfMonth.replace(/-/g, '');

    try {
        // PARALLEL FETCH: Teamwork Data + Saved Rates
        const [twResponse, ratesResponse] = await Promise.all([
            fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&billableType=billable&fromDate=${fromDate}&toDate=${toDate}`, { headers: { 'Authorization': authHeader } }),
            fetch(`https://api.github.com/repos/${REPO}/contents/${PATH}`, { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } })
        ]);

        if (!twResponse.ok) throw new Error(`API Error: ${twResponse.status}`);

        const data = await twResponse.json();
        
        // Parse Rates (Default to empty if missing)
        let savedRates = {};
        if (ratesResponse.ok) {
            savedRates = await ratesResponse.json();
        }

        const entries = data['time-entries'] || [];
        // READ GLOBAL RATE FROM DB OR DEFAULT TO 155
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        let users = {};
        let projects = {};

        entries.forEach(entry => {
            const hours = parseFloat(entry.hours) + (parseFloat(entry.minutes) / 60);
            const user = entry['person-first-name'] + ' ' + entry['person-last-name'];
            const project = entry['project-name'];
            
            if (project.match(/IWD|Runners|Dominate/i)) return;

            if (!users[user]) users[user] = 0;
            users[user] += hours;

            if (!projects[project]) projects[project] = 0;
            projects[project] += hours;
        });

        const userList = Object.keys(users).map(name => ({ name, hours: users[name] }));
        
        // Apply Rates Server-Side (Merge Teamwork + Saved JSON)
        const projectList = Object.keys(projects).map(name => {
            // Check by ID (sanitized) or Name
            const id = name.replace(/[^a-z0-9]/gi, '');
            const rate = savedRates[id] || savedRates[name] || GLOBAL_RATE;
            
            return { 
                id: id, 
                name, 
                hours: projects[name], 
                rate: parseInt(rate),     
                def: GLOBAL_RATE 
            };
        });

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({
                users: userList,
                projects: projectList,
                meta: { count: entries.length, range: `${fromDate}-${toDate}`, serverTime: new Date().toISOString(), globalRate: GLOBAL_RATE }
            })
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};