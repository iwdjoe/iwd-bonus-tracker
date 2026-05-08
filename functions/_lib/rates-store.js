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
