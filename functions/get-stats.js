// SIMPLE CACHE (In-Memory)
let cache = {
    data: null,
    time: 0
};

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');

    // CACHE CHECK (1 minute TTL)
    const now = Date.now();
    if (cache.data && (now - cache.time < 60000)) {
        console.log("Serving from Cache");
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify(cache.data)
        };
    }

    try {
        // ROBUST FETCH: Get strictly this month's data
        // No fancy weeks, no parallel calls. Just get the core data to restore service.
        const d = new Date();
        const startMonth = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0].replace(/-/g, '');
        const today = d.toISOString().split('T')[0].replace(/-/g, '');
        
        const url = `https://iwdagency.teamwork.com/time_entries.json?page=1&pageSize=500&fromDate=${startMonth}&toDate=${today}`;
        const res = await fetch(url, { headers: { 'Authorization': AUTH } });
        
        if(!res.ok) throw new Error(`API ${res.status}`);
        
        const json = await res.json();
        
        // PROCESS DATA (Safe Mode)
        const entries = json['time-entries'] || [];
        let users = {};
        let projects = {};
        
        entries.forEach(e => {
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const user = e['person-first-name'] + ' ' + e['person-last-name'];
            const project = e['project-name'];
            
            if (!users[user]) users[user] = 0;
            users[user] += hours;
            
            if (!projects[project]) projects[project] = { hours: 0, rate: 155 }; // Default Rate
            projects[project].hours += hours;
        });

        // Format for Dashboard
        const userList = Object.keys(users).map(name => ({ name, hours: users[name] }));
        const projectList = Object.keys(projects).map(name => ({ id: name.replace(/[^a-z0-9]/gi, ''), name, hours: projects[name].hours, rate: 155, def: 155 }));

        const responseData = {
            users: userList,
            projects: projectList,
            meta: { serverTime: new Date().toISOString(), cached: false }
        };

        // Update Cache
        cache.data = { ...responseData, meta: { ...responseData.meta, cached: true } };
        cache.time = now;

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify(responseData)
        };

    } catch (error) {
        console.error("Critical Fail:", error);
        return { 
            statusCode: 500, 
            body: JSON.stringify({ error: "System Offline: " + error.message }) 
        };
    }
};