// MAIN BACKEND (V86 - BULLETPROOF DATE LOGIC)
let cache = { data: null, time: 0 };

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";
    
    // CACHE: 1 Minute (Short cache for fast debugging)
    if (cache.data && (Date.now() - cache.time < 60000)) {
        return { statusCode: 200, body: JSON.stringify(cache.data) };
    }

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        
        // ========================================
        // BULLETPROOF DATE LOGIC (V86)
        // ========================================
        
        // Helper: Convert date string (YYYY-MM-DD) to comparable integer (YYYYMMDD)
        const toInt = (dateStr) => parseInt(dateStr.replace(/-/g, ''), 10);
        
        // Get today in local timezone (where the function runs)
        const now = new Date();
        
        // Calculate Monday of current week (ISO week starts Monday)
        const dayOfWeek = now.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
        const daysFromMonday = (dayOfWeek === 0) ? 6 : dayOfWeek - 1; // If Sunday, go back 6 days
        const thisMonday = new Date(now);
        thisMonday.setDate(now.getDate() - daysFromMonday);
        thisMonday.setHours(0, 0, 0, 0);
        
        // Calculate Monday of last week
        const lastMonday = new Date(thisMonday);
        lastMonday.setDate(thisMonday.getDate() - 7);
        
        // Calculate start of current month
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        monthStart.setHours(0, 0, 0, 0);
        
        // Convert to YYYY-MM-DD strings (local timezone)
        const formatDate = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };
        
        const thisWeekStart = formatDate(thisMonday);
        const lastWeekStart = formatDate(lastMonday);
        const monthStartStr = formatDate(monthStart);
        
        // Convert to integers for fast comparison
        const thisWeekInt = toInt(thisWeekStart);
        const lastWeekInt = toInt(lastWeekStart);
        const monthStartInt = toInt(monthStartStr);
        
        // ========================================
        // FETCH SAFE RANGE (Last 45 days)
        // ========================================
        const fetchStart = new Date(now);
        fetchStart.setDate(now.getDate() - 45);
        const fetchEnd = new Date(now);
        fetchEnd.setDate(now.getDate() + 2); // +2 days for safety
        
        const fetchStartStr = formatDate(fetchStart).replace(/-/g, '');
        const fetchEndStr = formatDate(fetchEnd).replace(/-/g, '');

        // Fetch time entries
        const twRes = await fetch(`https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}`, { 
            headers: { 'Authorization': AUTH } 
        });
        if(!twRes.ok) throw new Error("Teamwork API " + twRes.status);
        const twData = await twRes.json();
        
        // Fetch rates
        const ratesRes = await fetch(`https://api.github.com/repos/${REPO}/contents/rates.json`, { 
            headers: { 
                "Authorization": `token ${GH_TOKEN}`, 
                "Accept": "application/vnd.github.v3.raw" 
            } 
        });
        const savedRates = ratesRes.ok ? await ratesRes.json() : {};
        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;

        const entries = twData['time-entries'] || [];
        
        // ========================================
        // PROCESS & FILTER IN MEMORY
        // ========================================
        let users = {};
        let projects = {};
        let wStats = { 
            thisWeek: { b: 0, t: 0 }, 
            lastWeek: { b: 0, t: 0 } 
        };

        entries.forEach(e => {
            // Skip internal projects
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const isBill = e['isbillable'] === '1';
            const dateStr = e.date; // Format: "YYYY-MM-DD"
            const dateInt = toInt(dateStr);

            // ========================================
            // MAIN STATS (Current Month Only)
            // ========================================
            if (dateInt >= monthStartInt) {
                const user = e['person-first-name'] + ' ' + e['person-last-name'];
                const project = e['project-name'];
                
                if (isBill) {
                    if (!users[user]) users[user] = 0;
                    users[user] += hours;
                }
                
                if (!projects[project]) projects[project] = { hours: 0 };
                projects[project].hours += hours;
            }

            // ========================================
            // WEEKLY PULSE STATS
            // ========================================
            
            // This Week (from this Monday onwards)
            if (dateInt >= thisWeekInt) {
                wStats.thisWeek.t += hours;
                if (isBill) wStats.thisWeek.b += hours;
            }
            // Last Week (from last Monday, but BEFORE this Monday)
            else if (dateInt >= lastWeekInt && dateInt < thisWeekInt) {
                wStats.lastWeek.t += hours;
                if (isBill) wStats.lastWeek.b += hours;
            }
        });

        // ========================================
        // BUILD RESPONSE
        // ========================================
        const userList = Object.keys(users).map(name => ({ 
            name, 
            hours: users[name] 
        }));
        
        const projectList = Object.keys(projects).map(name => {
            const id = name.replace(/[^a-z0-9]/gi, '');
            const rate = savedRates[id] || savedRates[name] || GLOBAL_RATE;
            return { 
                id, 
                name, 
                hours: projects[name].hours, 
                rate: parseInt(rate), 
                def: 155 
            };
        });

        const responseData = {
            users: userList,
            projects: projectList,
            meta: { 
                serverTime: new Date().toISOString(), 
                globalRate: GLOBAL_RATE, 
                cached: false,
                debug: {
                    thisWeekStart,
                    lastWeekStart,
                    monthStartStr,
                    entriesProcessed: entries.length
                }
            },
            weekly: { 
                thisWeek: { 
                    billable: Math.round(wStats.thisWeek.b * 10) / 10, 
                    total: Math.round(wStats.thisWeek.t * 10) / 10 
                },
                lastWeek: { 
                    billable: Math.round(wStats.lastWeek.b * 10) / 10, 
                    total: Math.round(wStats.lastWeek.t * 10) / 10 
                }, 
                ranges: { 
                    this: `${thisWeekStart} onwards`, 
                    last: `${lastWeekStart} to ${thisWeekStart}` 
                }
            }
        };
        
        cache.data = responseData;
        cache.time = Date.now();

        return { 
            statusCode: 200, 
            body: JSON.stringify(responseData),
            headers: { 'Content-Type': 'application/json' }
        };

    } catch (error) {
        console.error('Function error:', error);
        return { 
            statusCode: 500, 
            body: JSON.stringify({ 
                error: error.message,
                stack: error.stack 
            }) 
        };
    }
};