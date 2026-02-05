exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    
    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        
        // JUST FETCH YESTERDAY (Tiny Request)
        const now = new Date();
        now.setDate(now.getDate() - 1);
        const yest = now.toISOString().split('T')[0].replace(/-/g, '');
        
        console.log("Fetching: " + yest);
        
        const res = await fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=5&fromDate=${yest}&toDate=${yest}`, { 
            headers: { 'Authorization': AUTH } 
        });
        
        if (!res.ok) {
            return { statusCode: 200, body: JSON.stringify({ error: `API ERROR: ${res.status} ${res.statusText}` }) };
        }
        
        const data = await res.json();
        
        return { 
            statusCode: 200, 
            body: JSON.stringify({ 
                success: true, 
                count: data['time-entries'] ? data['time-entries'].length : 0,
                sample: data['time-entries'] ? data['time-entries'][0] : null
            }) 
        };

    } catch (e) {
        return { statusCode: 200, body: JSON.stringify({ error: `EXCEPTION: ${e.message}` }) };
    }
};