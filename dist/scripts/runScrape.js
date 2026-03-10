// ============================================================
// scripts/runScrape.ts
// Manual Bright Data scrape trigger
//
// Usage:  npm run scrape
// ============================================================
import 'dotenv/config';
import { runAllScrapes } from '../services/brightdata.js';
async function main() {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║  CityPulse AI — Bright Data Scraper      ║');
    console.log('╚══════════════════════════════════════════╝\n');
    if (!process.env.BRIGHT_DATA_API_KEY || process.env.BRIGHT_DATA_API_KEY === 'your-brightdata-api-key') {
        console.warn('⚠️  BRIGHT_DATA_API_KEY not configured in .env');
        console.warn('   Get your key from: https://brightdata.com → Dashboard → API Keys');
        console.warn('   The scrape will fail without a valid key.\n');
    }
    console.log('🌐 Starting all scrape jobs...\n');
    try {
        const result = await runAllScrapes();
        console.log('\n══════════════════════════════════════════');
        console.log('✅ Scrape run complete!');
        console.log(`   Total new records: ${result.total}`);
        console.log('');
        result.jobs.forEach(j => {
            console.log(`   ${j.source}: ${j.records} records (job: ${j.jobId.slice(0, 8)}…)`);
        });
        console.log('');
        console.log('View audit log:');
        console.log('  curl http://localhost:4000/api/scrape/jobs');
        console.log('');
        console.log('Run AI analysis on new data:');
        console.log('  npm run seed:analyze');
        console.log('══════════════════════════════════════════\n');
    }
    catch (err) {
        console.error('\n❌ Scrape failed:', err.message);
        process.exit(1);
    }
}
main();
