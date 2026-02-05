// MAIN BACKEND (V90 - THE CLEANER)
// Single source of truth for both dashboards
// FETCH STRATEGY: Last 45 days to guarantee data availability
// FILTER LOGIC: Strict JavaScript filtering using YYYYMMDD integers

let cache = { data: null, time: 0 };

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";
    
    // CACHE: 1 Minute
    if (cache.data && (Date.now() - cache.time < 60000)) {
        return { statusCode: 200, body: JSON.stringify(cache.data) };
    }

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        
        // ========================================
        // DATE LOGIC
        // ========================================
        const toInt = (dateStr) => parseInt(dateStr.replace(/-/g, ''), 10);
        
        const now = new Date();
        
        // Monday of current week
        const dayOfWeek = now.getDay();
        const daysFromMonday = (dayOfWeek === 0) ? 6 : dayOfWeek - 1;
        const thisMonday = new Date(now);
        thisMonday.setDate(now.getDate() - daysFromMonday);
        thisMonday.setHours(0, 0, 0, 0);
        
        // Monday of last week
        const lastMonday = new Date(thisMonday);
        lastMonday.setDate(thisMonday.getDate() - 7);
        
        // Start of current month
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        monthStart.setHours(0, 0, 0, 0);
        
        const formatDate = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };
        
        const thisWeekStart = formatDate(thisMonday);
        const lastWeekStart = formatDate(lastMonday);
        const monthStartStr = formatDate(monthStart);
        
        const thisWeekInt = toInt(thisWeekStart);
        const lastWeekInt = toInt(lastWeekStart);
        const monthStartInt = toInt(monthStartStr);
        
        // ========================================
        // FETCH RANGE: Last 45 Days → Tomorrow
        // ========================================
        const fetchStart = new Date(now);
        fetchStart.setDate(now.getDate() - 45);
        const fetchEnd = new Date(now);
        fetchEnd.setDate(now.getDate() + 1);
        
        const fetchStartStr = formatDate(fetchStart).replace(/-/g, '');
        const fetchEndStr = formatDate(fetchEnd).replace(/-/g, '');

        console.log(`[GET-STATS] Fetching ${fetchStartStr} → ${fetchEndStr}`);

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
        
        console.log(`[GET-STATS] Found ${entries.length} entries`);
        
        // ========================================
        // FILTER & AGGREGATE
        // ========================================
        let users = {};
        let projects = {};
        let stats = { 
            thisWeek: { b: 0, t: 0 }, 
            lastWeek: { b: 0, t: 0 },
            month: { b: 0, t: 0 }
        };

        const sampleEntries = [];

        entries.forEach((e, idx) => {
            // Skip internal projects
            if (e['project-name'].match(/IWD|Runners|Dominate/i)) return;
            
            const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
            const isBill = e['isbillable'] === '1';
            const dateStr = e.date; // "YYYY-MM-DD"
            const dateInt = toInt(dateStr);

            // Debug: Capture first 3 entries
            if (idx < 3) {
                sampleEntries.push({
                    name: e['person-first-name'] + ' ' + e['person-last-name'],
                    date: dateStr,
                    hours: hours.toFixed(2),
                    billable: isBill
                });
            }

            // MONTHLY STATS (for main dashboard)
            if (dateInt >= monthStartInt) {
                const user = e['person-first-name'] + ' ' + e['person-last-name'];
                const project = e['project-name'];
                
                // Only billable hours count for user leaderboard
                if (isBill) {
                    if (!users[user]) users[user] = 0;
                    users[user] += hours;
                }
                
                // All hours count for project totals
                if (!projects[project]) projects[project] = { hours: 0 };
                projects[project].hours += hours;

                stats.month.t += hours;
                if (isBill) stats.month.b += hours;
            }

            // WEEKLY STATS (for pulse)
            if (dateInt >= thisWeekInt) {
                stats.thisWeek.t += hours;
                if (isBill) stats.thisWeek.b += hours;
            } else if (dateInt >= lastWeekInt && dateInt < thisWeekInt) {
                stats.lastWeek.t += hours;
                if (isBill) stats.lastWeek.b += hours;
            }
        });

        console.log(`[GET-STATS] This Week: ${stats.thisWeek.b}h billable / ${stats.thisWeek.t}h total`);
        console.log(`[GET-STATS] Last Week: ${stats.lastWeek.b}h billable / ${stats.lastWeek.t}h total`);

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
                    entriesProcessed: entries.length,
                    sampleEntries: sampleEntries
                }
            },
            pulse: {
                thisWeek: { 
                    b: Math.round(stats.thisWeek.b * 10) / 10, 
                    t: Math.round(stats.thisWeek.t * 10) / 10 
                },
                lastWeek: { 
                    b: Math.round(stats.lastWeek.b * 10) / 10, 
                    t: Math.round(stats.lastWeek.t * 10) / 10 
                },
                month: {
                    b: Math.round(stats.month.b * 10) / 10,
                    t: Math.round(stats.month.t * 10) / 10
                }
            }
        };
        
        cache.data = responseData;
        cache.time = Date.now();

        return { 
            statusCode: 200, 
            body: JSON.stringify(responseData),
            headers: { 
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=60'
            }
        };

    } catch (error) {
        console.error('[GET-STATS] ERROR:', error);
        return { 
            statusCode: 500, 
            body: JSON.stringify({ 
                error: error.message,
                stack: error.stack 
            }) 
        };
    }
};
