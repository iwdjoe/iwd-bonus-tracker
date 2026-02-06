const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// CONFIG
const TOKEN = process.env.TEAMWORK_API_TOKEN || 'dryer498desert'; // Hardcoded fallback for local dev
const DOMAIN = 'iwdagency.teamwork.com';
const GH_TOKEN = process.env.GITHUB_PAT; 
const REPO = "iwdjoe/iwd-bonus-tracker";
const OUT_FILE = path.join(__dirname, '../public/data.json');

// LOGIC
async function run() {
    console.log('--- STARTING PULSE SYNC (LOCAL) ---');
    
    // 1. DATES: Last 45 Days
    const now = new Date();
    const fetchStart = new Date(now);
    fetchStart.setDate(now.getDate() - 45);
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
    console.log(`Fetching from ${startStr} to ${endStr}`);

    // 2. FETCH RATES (From GitHub for consistency)
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
        } else {
            console.warn('Could not fetch rates from GitHub, using defaults.');
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
                // Safety break
                if (page > 20) hasMore = false;
            }
        } catch (e) {
            console.error('Error fetching page ' + page, e);
            hasMore = false;
        }
    }
    
    console.log(`Total raw entries: ${allEntries.length}`);

    // 4. PROCESS DATA (Mimic get-pulse.js logic)
    const cleanEntries = allEntries.map(e => {
        const user = (e['person-first-name'] + ' ' + e['person-last-name']).trim();
        const hours = parseFloat(e.hours) + (parseFloat(e.minutes) / 60);
        
        // Flags
        // Note: Logic copied from previous get-pulse.js
        const isIsah = user.match(/Isah/i) && user.match(/Ramos/i);
        const isInternal = e['project-name'].match(/IWD|Runners|Dominate/i);
        
        return {
            u: user,
            p: e['project-name'],
            pid: e['project-name'].replace(/[^a-z0-9]/gi, ''),
            d: e.date, // YYYYMMDD
            h: hours,
            b: e['isbillable'] === '1',
            i: !!isInternal, 
            x: !!isIsah      
        };
    }).filter(e => e.h > 0); // Remove 0 hour entries if any

    const finalData = {
        meta: {
            generated: new Date().toISOString(),
            count: cleanEntries.length,
            version: "v200-static"
        },
        rates: rates,
        globalRate: globalRate,
        entries: cleanEntries
    };

    // 5. SAVE TO FILE
    fs.writeFileSync(OUT_FILE, JSON.stringify(finalData, null, 2));
    console.log(`Saved to ${OUT_FILE}`);
}

run();
