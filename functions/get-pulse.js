// ============================================
// BULLETPROOF V139 - API WITH COMPREHENSIVE ERROR HANDLING
// ============================================

exports.handler = async function(event, context) {
    const fetch = require('node-fetch');
    
    // DEFENSIVE: Check environment variables
    const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert';
    const DOMAIN = 'iwdagency.teamwork.com';
    const GH_TOKEN = process.env.GITHUB_PAT; 
    const REPO = "iwdjoe/iwd-bonus-tracker";

    console.log('[API] Starting get-pulse handler...');
    console.log('[API] Environment check:', {
        hasToken: !!TOKEN,
        hasDomain: !!DOMAIN,
        hasGitHub: !!GH_TOKEN,
        hasRepo: !!REPO
    });

    try {
        const AUTH = 'Basic ' + Buffer.from(TOKEN + ':xxx').toString('base64');
        const now = new Date();
        
        console.log('[API] Current time:', now.toISOString());
        
        // SAFE DATE RANGE: 25 DAYS
        const fetchStart = new Date(now);
        fetchStart.setDate(now.getDate() - 25);
        const fetchEnd = new Date(now);
        fetchEnd.setDate(now.getDate() + 1);
        
        const formatDate = (date) => {
            try {
                if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
                    console.error('[API] Invalid date for formatting:', date);
                    return '19700101';
                }
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${y}${m}${day}`;
            } catch (e) {
                console.error('[API] Date format error:', e);
                return '19700101';
            }
        };

        const fetchStartStr = formatDate(fetchStart);
        const fetchEndStr = formatDate(fetchEnd);

        console.log('[API] Fetch range:', { start: fetchStartStr, end: fetchEndStr });

        // DEFENSIVE: Fetch with timeout and error handling
        const timeoutMs = 15000; // 15 second timeout
        
        const fetchWithTimeout = (url, options) => {
            return Promise.race([
                fetch(url, options),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
                )
            ]);
        };

        console.log('[API] Fetching from Teamwork API...');

        const [p1, p2, ratesRes] = await Promise.all([
            fetchWithTimeout(
                `https://${DOMAIN}/time_entries.json?page=1&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}&sortorder=desc`, 
                { headers: { 'Authorization': AUTH } }
            ).catch(e => {
                console.error('[API] Page 1 fetch error:', e);
                return { ok: false, error: e.message };
            }),
            fetchWithTimeout(
                `https://${DOMAIN}/time_entries.json?page=2&pageSize=500&fromDate=${fetchStartStr}&toDate=${fetchEndStr}&sortorder=desc`, 
                { headers: { 'Authorization': AUTH } }
            ).catch(e => {
                console.error('[API] Page 2 fetch error:', e);
                return { ok: false, error: e.message };
            }),
            fetchWithTimeout(
                `https://api.github.com/repos/${REPO}/contents/rates.json`, 
                { headers: { "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github.v3.raw" } }
            ).catch(e => {
                console.error('[API] GitHub fetch error:', e);
                return { ok: false, error: e.message };
            })
        ]);

        console.log('[API] Fetch complete:', {
            page1: p1.ok ? 'OK' : 'FAILED',
            page2: p2.ok ? 'OK' : 'FAILED',
            rates: ratesRes.ok ? 'OK' : 'FAILED'
        });

        // DEFENSIVE: Parse responses
        let d1 = {};
        let d2 = {};
        let savedRates = {};

        if (p1.ok) {
            try {
                const text = await p1.text();
                d1 = JSON.parse(text);
                console.log('[API] Page 1 parsed:', (d1['time-entries'] || []).length, 'entries');
            } catch (e) {
                console.error('[API] Page 1 parse error:', e);
                d1 = {};
            }
        } else {
            console.warn('[API] Page 1 failed, using empty data');
        }

        if (p2.ok) {
            try {
                const text = await p2.text();
                d2 = JSON.parse(text);
                console.log('[API] Page 2 parsed:', (d2['time-entries'] || []).length, 'entries');
            } catch (e) {
                console.error('[API] Page 2 parse error:', e);
                d2 = {};
            }
        } else {
            console.warn('[API] Page 2 failed, using empty data');
        }

        if (ratesRes.ok) {
            try {
                const text = await ratesRes.text();
                savedRates = JSON.parse(text);
                console.log('[API] Rates parsed:', Object.keys(savedRates).length, 'entries');
            } catch (e) {
                console.error('[API] Rates parse error:', e);
                savedRates = {};
            }
        } else {
            console.warn('[API] Rates fetch failed, using defaults');
        }

        const GLOBAL_RATE = savedRates['__GLOBAL_RATE__'] || 155;
        console.log('[API] Using global rate:', GLOBAL_RATE);

        // DEFENSIVE: Merge entries
        const entries = [
            ...(Array.isArray(d1['time-entries']) ? d1['time-entries'] : []),
            ...(Array.isArray(d2['time-entries']) ? d2['time-entries'] : [])
        ];

        console.log('[API] Total raw entries:', entries.length);

        if (entries.length === 0) {
            console.warn('[API] WARNING: No entries fetched! This might indicate an API problem.');
        }

        // DEFENSIVE: Clean & flag entries
        const cleanEntries = [];
        let errorCount = 0;

        entries.forEach((e, idx) => {
            try {
                if (!e || typeof e !== 'object') {
                    console.warn(`[API] Entry ${idx} is not an object:`, e);
                    errorCount++;
                    return;
                }

                const firstName = e['person-first-name'] || '';
                const lastName = e['person-last-name'] || '';
                const user = firstName + ' ' + lastName;
                
                const rawHours = parseFloat(e.hours) || 0;
                const rawMinutes = parseFloat(e.minutes) || 0;
                const hours = rawHours + (rawMinutes / 60);
                
                const projectName = e['project-name'] || 'Unknown Project';
                const date = e.date || '';
                const isBillable = e['isbillable'] === '1';
                
                // FLAGS
                const isIsah = !!(user.match(/Isah/i) && user.match(/Ramos/i));
                const isInternal = !!(projectName.match(/IWD|Runners|Dominate/i));

                if (!date) {
                    console.warn(`[API] Entry ${idx} has no date, skipping:`, e);
                    errorCount++;
                    return;
                }

                cleanEntries.push({
                    u: user,
                    p: projectName,
                    pid: projectName.replace(/[^a-z0-9]/gi, ''),
                    d: date,
                    h: hours,
                    b: isBillable,
                    i: isInternal,
                    x: isIsah
                });
            } catch (entryError) {
                console.error(`[API] Error processing entry ${idx}:`, entryError);
                errorCount++;
            }
        });

        console.log('[API] Clean entries:', cleanEntries.length);
        console.log('[API] Errors during cleaning:', errorCount);

        // VALIDATE: Make sure we have SOME data
        if (cleanEntries.length === 0 && entries.length > 0) {
            console.error('[API] CRITICAL: All entries failed to process!');
            return { 
                statusCode: 500, 
                body: JSON.stringify({ 
                    error: 'Data processing failed',
                    details: `Fetched ${entries.length} entries but all failed validation`,
                    errorCount: errorCount
                }) 
            };
        }

        const response = { 
            entries: cleanEntries,
            rates: savedRates,
            globalRate: GLOBAL_RATE,
            meta: { 
                count: cleanEntries.length,
                version: "V139-Bulletproof",
                timestamp: now.toISOString(),
                fetchRange: { start: fetchStartStr, end: fetchEndStr },
                errors: errorCount
            }
        };

        console.log('[API] Success! Returning', cleanEntries.length, 'entries');

        return { 
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            },
            body: JSON.stringify(response)
        };

    } catch (error) {
        console.error('[API] FATAL ERROR:', error);
        console.error('[API] Stack:', error.stack);
        
        return { 
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString(),
                version: "V139-Bulletproof"
            })
        };
    }
};
