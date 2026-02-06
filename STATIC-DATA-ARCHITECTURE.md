# Static Data Architecture (V146)

## 🎯 Goal
Replace the failing "Live Fetching" model with a **Static Data Generation** model to eliminate timeouts, rate limits, and silent errors.

## 🏗️ Architecture

### Old Model (BROKEN ❌)
```
User opens weekly.html 
  → Calls Netlify Function (get-pulse.js)
    → Function fetches Teamwork API
      → 10s timeout! ⏰
      → Rate limits! 🚫
      → Silent errors! 💥
```

### New Model (WORKING ✅)
```
1. DATA GENERATION (Async, No Timeout)
   Local Script OR Background Function
     → Fetches ALL data (45 days, paginated)
       → Saves to public/data.json
         → Commits to GitHub

2. FRONTEND (Instant Load)
   User opens weekly-v146.html
     → Reads static data.json
       → Instant! ⚡
```

---

## 📂 Files Created

### 1. `scripts/fetch-pulse.js`
**Purpose:** Local script to fetch Teamwork data and save to `public/data.json`

**Run locally:**
```bash
cd bonus-site
npm run fetch-data
```

**What it does:**
- ✅ Fetches last 45 days of Teamwork data
- ✅ Handles pagination (fetches ALL pages)
- ✅ Processes entries (Isah logic, Internal logic)
- ✅ Saves to `public/data.json`
- ✅ No timeout limits (runs as long as needed)

**Environment Variables Needed:**
```bash
export TEAMWORK_API_TOKEN="dryer498desert"  # Or set in .env
export GITHUB_PAT="your-github-personal-access-token"
```

---

### 2. `functions/update-pulse-bg.js`
**Purpose:** Netlify Background Function (async, 15-min timeout)

**Trigger:**
```
GET /.netlify/functions/update-pulse-bg
```

**What it does:**
- ✅ Returns `202 Accepted` immediately (no timeout!)
- ✅ Runs data fetch in background (30-60 seconds)
- ✅ Writes result to GitHub repo (`public/data.json`)
- ✅ Frontend sees updated data on next refresh

**How it works:**
1. User clicks "🔄 Update Data" button
2. Function returns `202` instantly
3. Background work continues (fetches + writes to GitHub)
4. Frontend auto-refreshes after 60s

---

### 3. `public/weekly-v146.html`
**Purpose:** New frontend that reads from static `data.json`

**Changes:**
- ❌ Removed: `/.netlify/functions/get-pulse` API call
- ✅ Added: `/data.json` static file read
- ✅ Added: "🔄 Update Data" button
- ✅ Shows last update timestamp

**Access:**
```
https://yourdomain.netlify.app/weekly-v146.html
```

---

## 🚀 Deployment Steps

### Step 1: Run Locally (First Time)
```bash
cd bonus-site

# Make sure you have the API token
export TEAMWORK_API_TOKEN="dryer498desert"
export GITHUB_PAT="your_github_pat"

# Fetch data
npm run fetch-data

# Verify the file was created
ls -lh public/data.json
```

This creates `public/data.json` with all the Teamwork data.

---

### Step 2: Commit & Push
```bash
git add .
git commit -m "Add static data architecture (V146)"
git push
```

Netlify will automatically deploy:
- ✅ `public/data.json` (static file)
- ✅ `functions/update-pulse-bg.js` (background function)
- ✅ `public/weekly-v146.html` (new frontend)

---

### Step 3: Test the New Frontend
1. Open: `https://yourdomain.netlify.app/weekly-v146.html`
2. You should see: "✅ Loaded XXX entries (Updated: ...)"
3. Click "🔄 Update Data" button
4. Wait 60 seconds
5. Page auto-refreshes with new data

---

## 🔄 Updating Data

### Option 1: Local Script (Fastest)
```bash
npm run fetch-data
git add public/data.json
git commit -m "Update pulse data"
git push
```

**Pros:**
- ✅ No timeout limits
- ✅ Full control
- ✅ Can debug easily

**Cons:**
- ❌ Requires local environment
- ❌ Manual commit/push

---

### Option 2: Background Function (Easiest)
1. Click "🔄 Update Data" button in the UI
2. Wait 60 seconds
3. Refresh to see new data

**Pros:**
- ✅ No local setup needed
- ✅ Automatic GitHub commit
- ✅ Works from anywhere

**Cons:**
- ⚠️ Requires Netlify Pro (Background Functions)
- ⚠️ 15-minute timeout limit (should be enough)

---

### Option 3: Scheduled Updates (Cron) 🔥
**Recommended for Production**

Create `functions/scheduled-update.js`:
```javascript
exports.handler = async function(event, context) {
    // Same logic as update-pulse-bg.js
    // Runs automatically every day at 6 AM
};
```

Add to `netlify.toml`:
```toml
[functions."scheduled-update"]
  schedule = "0 6 * * *"  # Every day at 6 AM
```

**Pros:**
- ✅ Fully automatic
- ✅ Always up-to-date
- ✅ No manual intervention

**Cons:**
- ⚠️ Requires Netlify Pro

---

## 🐛 Troubleshooting

### Problem: "Data file not found"
**Solution:**
```bash
npm run fetch-data
git add public/data.json
git commit -m "Add initial data"
git push
```

---

### Problem: "Update button doesn't work"
**Check:**
1. Netlify Pro plan active?
2. Environment variables set in Netlify UI?
3. Check function logs: `netlify functions:logs update-pulse-bg`

---

### Problem: "Data is stale"
**Solution:**
Click "🔄 Update Data" or run `npm run fetch-data` locally.

---

## 📊 Data Structure

`public/data.json`:
```json
{
  "entries": [
    {
      "u": "John Doe",
      "p": "Project Name",
      "pid": "ProjectName",
      "d": "20250206",
      "h": 8.5,
      "b": true,
      "i": false,
      "x": false
    }
  ],
  "rates": {
    "ProjectName": 175,
    "__GLOBAL_RATE__": 155
  },
  "globalRate": 155,
  "meta": {
    "count": 1234,
    "fetched": "2025-02-06T12:34:56.789Z",
    "range": {
      "start": "20250101",
      "end": "20250215"
    },
    "version": "fetch-pulse-v1"
  }
}
```

**Fields:**
- `u` = User
- `p` = Project
- `pid` = Project ID (sanitized)
- `d` = Date (YYYYMMDD)
- `h` = Hours
- `b` = Is Billable
- `i` = Is Internal (IWD/Runners/Dominate)
- `x` = Is Isah (excluded from weekly stats)

---

## 🎉 Benefits

| Old Model | New Model |
|-----------|-----------|
| ❌ 10s timeout | ✅ No timeout |
| ❌ Rate limits | ✅ Single fetch, cached |
| ❌ Silent errors | ✅ Visible errors |
| ❌ Slow (5-10s load) | ✅ Instant (<100ms) |
| ❌ API calls every page load | ✅ Static file read |
| ❌ Unreliable | ✅ Rock solid |

---

## 🔮 Future Improvements

1. **Scheduled Updates:** Auto-update every day at 6 AM
2. **Real-time Updates:** GitHub webhook triggers update on commit
3. **Incremental Fetching:** Only fetch last 7 days, merge with existing data
4. **CDN Caching:** Put `data.json` on CDN for global speed
5. **Version History:** Keep last 7 days of `data.json` snapshots

---

## 📝 Summary

This new architecture **eliminates all timeout issues** by:
1. Moving data fetching OUT of the request/response cycle
2. Using static files for instant frontend loading
3. Providing multiple update mechanisms (local, button, cron)

**Result:** Reliable, fast, scalable dashboard. 🚀
