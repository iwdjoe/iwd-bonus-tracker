exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    
    // --- SHARED RATE CONFIGURATION ---
    // Update these here so the whole team sees the same numbers.
    const GLOBAL_RATE = 155;
    const RATE_OVERRIDES = {
        // "Project Name": Rate
        "SchoolFix - Migration to Adobe Live Search": 140,
        "DMC Tools - Maintenance": 140,
        // Add others here as needed
    };
    // ---------------------------------

    // Auth Check
    if (!TOKEN) return { statusCode: 500, body: JSON.stringify({ error: "Missing Token" }) };

    const authHeader = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    const fromDate = startOfMonth.replace(/-/g, '');
    const toDate = endOfMonth.replace(/-/g, '');

    try {
        const url = `https://${DOMAIN}/time_entries.json?page=1&pageSize=500&billableType=billable&fromDate=${fromDate}&toDate=${toDate}`;
        const response = await fetch(url, { headers: { 'Authorization': authHeader } });
        
        if (!response.ok) throw new Error(`API Error: ${response.status}`);

        const data = await response.json();
        const entries = data['time-entries'] || [];

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
        
        // Apply Rates Server-Side
        const projectList = Object.keys(projects).map(name => {
            const rate = RATE_OVERRIDES[name] || GLOBAL_RATE;
            return { 
                id: name.replace(/[^a-z0-9]/gi, ''), 
                name, 
                hours: projects[name], 
                rate: rate,     // The actual active rate
                def: GLOBAL_RATE // The global default for comparison
            };
        });

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({
                users: userList,
                projects: projectList,
                meta: { count: entries.length, range: `${fromDate}-${toDate}`, serverTime: new Date().toISOString() }
            })
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};