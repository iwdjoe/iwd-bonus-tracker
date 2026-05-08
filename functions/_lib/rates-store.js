// Rates storage backed by Netlify Blobs.
//
// First-call seed: if the blob is empty (e.g. fresh deploy, never written),
// fall back to the bundled rates.json snapshot and persist it. After that,
// the blob is the source of truth and rates.json is only kept around as a
// disaster-recovery seed.

const { getStore } = require('@netlify/blobs');
const seed = require('../../rates.json');

const STORE = 'rates';
const KEY = 'current';

function store() {
    // Prefer auto-context (works in modern Netlify function runtime). Fall
    // back to explicit siteID + token if NETLIFY_BLOBS_TOKEN is provided
    // (used as escape hatch when auto-context isn't injected).
    const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN;
    if (siteID && token) {
        return getStore({ name: STORE, siteID, token });
    }
    return getStore(STORE);
}

async function readRates() {
    const data = await store().get(KEY, { type: 'json' });
    if (data && typeof data === 'object') return data;
    // Seed on first ever read
    await store().setJSON(KEY, seed);
    return { ...seed };
}

async function writeRates(rates) {
    await store().setJSON(KEY, rates);
}

module.exports = { readRates, writeRates };
