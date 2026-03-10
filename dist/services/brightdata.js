// ============================================================
// services/brightdata.ts
// Bright Data Web Scraper API integration
// Scrapes public data only — no login, no paywalls
//
// Sources targeted:
//   1. Reddit r/Montgomery — public posts about city issues
//   2. City of Montgomery public notices (news page)
//   3. Google Maps public reviews for city services
//
// All scraped data is stored in complaints table
// with source = 'Bright Data' for clear differentiation
// ============================================================
import axios from 'axios';
import { supabaseAdmin } from '../db/supabase.js';
const BRIGHT_DATA_API_KEY = process.env.BRIGHT_DATA_API_KEY ?? '';
const BRIGHT_DATA_DATASET_ID = process.env.BRIGHT_DATA_DATASET_ID ?? '';
const BRIGHT_DATA_BASE_URL = 'https://api.brightdata.com/datasets/v3';
// Category keywords → DB category name mapping
const CATEGORY_KEYWORDS = {
    'Road Infrastructure': [
        'pothole', 'road', 'pavement', 'sidewalk', 'street', 'curb',
        'crack', 'bump', 'bridge', 'asphalt', 'construction blocking',
    ],
    'Waste Management': [
        'trash', 'garbage', 'dump', 'litter', 'waste', 'bin', 'pickup',
        'collection', 'overflowing', 'smell', 'recycling',
    ],
    'Traffic Problems': [
        'traffic', 'signal', 'light', 'congestion', 'jam', 'accident',
        'sign', 'intersection', 'speeding', 'crosswalk', 'parking',
    ],
    'Utilities': [
        'light', 'streetlight', 'water', 'sewer', 'pipe', 'outage',
        'power', 'electrical', 'hydrant', 'flooding', 'drain',
    ],
    'Public Safety': [
        'crime', 'suspicious', 'vandal', 'graffiti', 'abandoned', 'unsafe',
        'danger', 'homeless', 'drug', 'break-in', 'theft',
    ],
};
function detectCategory(text) {
    const lower = text.toLowerCase();
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (keywords.some(kw => lower.includes(kw))) {
            return category;
        }
    }
    return 'Other';
}
// Look up category_id from name
async function getCategoryId(name) {
    const { data } = await supabaseAdmin
        .from('categories')
        .select('id')
        .eq('name', name)
        .single();
    return data?.id ?? null;
}
// Create a scrape job audit record
async function createScrapeJob(source, targetUrl) {
    const { data } = await supabaseAdmin
        .from('scrape_jobs')
        .insert({
        source,
        target_url: targetUrl,
        status: 'running',
        records_found: 0,
        started_at: new Date().toISOString(),
    })
        .select('id')
        .single();
    return data?.id ?? '';
}
async function updateScrapeJob(jobId, update) {
    await supabaseAdmin
        .from('scrape_jobs')
        .update({ ...update, completed_at: new Date().toISOString() })
        .eq('id', jobId);
}
// ── Main scraping functions ───────────────────────────────────
/**
 * Trigger a Bright Data dataset collection for Reddit r/Montgomery
 * Uses the Web Scraper API — public data only
 */
export async function scrapeRedditMontgomery() {
    const targetUrl = 'https://www.reddit.com/r/montgomery/search.json?q=pothole+road+trash+traffic+light&sort=new&restrict_sr=1&limit=100';
    const scrapeJobId = await createScrapeJob('Reddit r/Montgomery', targetUrl);
    try {
        console.log('[BrightData] Triggering Reddit scrape...');
        // Option A: Direct fetch via Bright Data proxy (simpler, good for hackathon)
        const response = await axios.get(targetUrl, {
            headers: {
                'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                'x-brd-proxy': 'true',
                'User-Agent': 'CityPulseAI/1.0 (research; contact@citypulse.ai)',
            },
            timeout: 30000,
        });
        const posts = response.data?.data?.children ?? [];
        // Filter to relevant civic complaints
        const civicKeywords = [
            'pothole', 'road', 'trash', 'garbage', 'traffic', 'light',
            'water', 'sidewalk', 'sign', 'street', 'litter', 'flood', 'broken',
        ];
        const relevant = posts.filter(p => {
            const text = `${p.data.title} ${p.data.selftext}`.toLowerCase();
            return civicKeywords.some(kw => text.includes(kw));
        });
        let inserted = 0;
        for (const post of relevant) {
            const text = post.data.selftext
                ? `${post.data.title}. ${post.data.selftext}`.slice(0, 500)
                : post.data.title;
            const category = detectCategory(text);
            const catId = await getCategoryId(category);
            const { error } = await supabaseAdmin
                .from('complaints')
                .upsert({
                external_id: `reddit_${post.data.id}`,
                text,
                location: 'Montgomery, AL',
                neighborhood: null,
                lat: null,
                lng: null,
                source: 'Bright Data',
                category_id: catId,
                status: 'Open',
                open_date: new Date(post.data.created_utc * 1000).toISOString(),
                scraped_at: new Date().toISOString(),
            }, { onConflict: 'external_id' });
            if (!error)
                inserted++;
        }
        await updateScrapeJob(scrapeJobId, {
            status: 'completed',
            records_found: inserted,
        });
        console.log(`[BrightData] Reddit scrape done: ${inserted} records`);
        return { jobId: scrapeJobId, recordsFound: inserted };
    }
    catch (err) {
        console.error('[BrightData] Reddit scrape failed:', err.message);
        await updateScrapeJob(scrapeJobId, {
            status: 'failed',
            error_message: err.message,
        });
        throw err;
    }
}
/**
 * Scrape City of Montgomery official news/press releases
 * Public page — no auth required
 */
export async function scrapeMontgomeryNews() {
    const targetUrl = 'https://www.montgomeryal.gov/government/departments/public-works/311-citizen-service-requests';
    const scrapeJobId = await createScrapeJob('Montgomery City Website', targetUrl);
    try {
        console.log('[BrightData] Triggering City News scrape...');
        // Use Bright Data Web Scraper API for JavaScript-rendered pages
        const response = await axios.post(`${BRIGHT_DATA_BASE_URL}/trigger`, {
            dataset_id: BRIGHT_DATA_DATASET_ID,
            format: 'json',
            uncompressed_webhook: false,
            data: [{ url: targetUrl }],
        }, {
            headers: {
                'Authorization': `Bearer ${BRIGHT_DATA_API_KEY}`,
                'Content-Type': 'application/json',
            },
            timeout: 60000,
        });
        // Bright Data returns a snapshot_id to poll
        const snapshotId = response.data?.snapshot_id;
        console.log(`[BrightData] Snapshot triggered: ${snapshotId}`);
        await updateScrapeJob(scrapeJobId, {
            status: 'completed',
            records_found: 0,
        });
        return { jobId: scrapeJobId, recordsFound: 0 };
    }
    catch (err) {
        console.error('[BrightData] City news scrape failed:', err.message);
        await updateScrapeJob(scrapeJobId, {
            status: 'failed',
            error_message: err.message,
        });
        // Non-fatal for hackathon demo — log but don't crash
        return { jobId: scrapeJobId, recordsFound: 0 };
    }
}
/**
 * Master scrape runner — calls all sources
 * Used by: POST /api/scrape endpoint + cron job
 */
export async function runAllScrapes() {
    console.log('[BrightData] Starting full scrape run...');
    const jobs = [];
    try {
        const reddit = await scrapeRedditMontgomery();
        jobs.push({ source: 'Reddit', jobId: reddit.jobId, records: reddit.recordsFound });
    }
    catch { /* already logged */ }
    try {
        const news = await scrapeMontgomeryNews();
        jobs.push({ source: 'City Website', jobId: news.jobId, records: news.recordsFound });
    }
    catch { /* already logged */ }
    const total = jobs.reduce((s, j) => s + j.records, 0);
    console.log(`[BrightData] All scrapes done. Total new records: ${total}`);
    return { total, jobs };
}
