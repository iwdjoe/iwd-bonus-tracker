exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN;
    const DOMAIN = 'iwdagency.teamwork.com';
    
    // Auth Check
    if (!TOKEN) {
        return { statusCode: 500, body: JSON.stringify({ error: "Missing TEAMWORK_API_TOKEN env var" }) };
    }

    // Helper: Base64 Encode Token
    const authHeader = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');

    // Date Range: Current Month (Feb 2026 Logic)
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    const dateRange = `${startOfMonth.replace(/-/g,'')}000000:${endOfMonth.replace(/-/g,'')}235959`;

    try {
        // Fetch Time Entries
        const url = `https://${DOMAIN}/time_entries.json?page=1&pageSize=500&billableType=billable&fromDate=${dateRange.split(':')[0].slice(0,8)}&toDate=${dateRange.split(':')[1].slice(0,8)}`;
        
        console.log("Fetching from:", url);
        
        const response = await fetch(url, {
            headers: { 'Authorization': authHeader }
        });
        
        if (!response.ok) {
            throw new Error(`Teamwork API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const entries = data['time-entries'] || [];

        // Aggregation Logic
        let users = {};
        let projects = {};

        entries.forEach(entry => {
            const hours = parseFloat(entry.hours) + (parseFloat(entry.minutes) / 60);
            const user = entry['person-first-name'] + ' ' + entry['person-last-name'];
            const project = entry['project-name'];
            
            // Skip Internal Projects (Hardcoded Filter)
            if (project.match(/IWD|Runners|Dominate/i)) return;

            // User Aggregate
            if (!users[user]) users[user] = 0;
            users[user] += hours;

            // Project Aggregate
            if (!projects[project]) projects[project] = 0;
            projects[project] += hours;
        });

        // Format Output
        const userList = Object.keys(users).map(name => ({ name, hours: users[name] }));
        const projectList = Object.keys(projects).map(name => ({ id: name.replace(/[^a-z0-9]/gi, ''), name, hours: projects[name], def: 150 }));

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*" // Allow CORS for local testing
            },
            body: JSON.stringify({
                users: userList,
                projects: projectList,
                meta: { count: entries.length, range: dateRange }
            })
        };

    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};