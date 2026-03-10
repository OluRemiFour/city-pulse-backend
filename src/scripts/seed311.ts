// ============================================================
// scripts/seed311.ts
// Imports Montgomery 311 JSON into Supabase
//
// Usage:
//   1. Place your downloaded JSON file at: backend/data/montgomery311.json
//      (from the URL you fetched)
//   2. npm run seed:311
//
// The script is idempotent — safe to run multiple times.
// It uses external_id (OBJECTID) to upsert, so no duplicates.
// ============================================================

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { supabaseAdmin } from '../db/supabase.js';
import type { Montgomery311Feature, Montgomery311Response } from '../types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────
const DATA_FILE = join(__dirname, '../../data/montgomery311.json');
const BATCH_SIZE = 100; // Insert in batches to avoid payload limits

// ── Category mapping ──────────────────────────────────────────
// Maps Montgomery 311 Request_Type values → our category names
// Adjust these based on what's actually in your JSON file
const CATEGORY_MAP: Record<string, string> = {
  // Road / Infrastructure
  'pothole':                  'Road Infrastructure',
  'road damage':              'Road Infrastructure',
  'road repair':              'Road Infrastructure',
  'sidewalk':                 'Road Infrastructure',
  'street repair':            'Road Infrastructure',
  'curb repair':              'Road Infrastructure',
  'bridge':                   'Road Infrastructure',
  'street cut':               'Road Infrastructure',

  // Waste
  'trash':                    'Waste Management',
  'garbage':                  'Waste Management',
  'bulk pickup':              'Waste Management',
  'missed collection':        'Waste Management',
  'illegal dumping':          'Waste Management',
  'recycling':                'Waste Management',
  'debris':                   'Waste Management',
  'litter':                   'Waste Management',

  // Traffic
  'traffic signal':           'Traffic Problems',
  'traffic light':            'Traffic Problems',
  'sign':                     'Traffic Problems',
  'traffic':                  'Traffic Problems',
  'speed bump':               'Traffic Problems',
  'crosswalk':                'Traffic Problems',
  'parking':                  'Traffic Problems',

  // Utilities
  'street light':             'Utilities',
  'streetlight':              'Utilities',
  'water':                    'Utilities',
  'sewer':                    'Utilities',
  'utility':                  'Utilities',
  'storm drain':              'Utilities',
  'flooding':                 'Utilities',
  'electrical':               'Utilities',

  // Safety
  'graffiti':                 'Public Safety',
  'abandoned vehicle':        'Public Safety',
  'abandoned property':       'Public Safety',
  'public safety':            'Public Safety',
  'hazard':                   'Public Safety',
  'code enforcement':         'Public Safety',
};

function mapCategory(requestType: string | undefined): string {
  if (!requestType) return 'Other';
  const lower = requestType.toLowerCase();
  for (const [keyword, category] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(keyword)) return category;
  }
  return 'Other';
}

function mapStatus(rawStatus: string | undefined): string {
  if (!rawStatus) return 'Open';
  const lower = rawStatus.toLowerCase();
  if (lower.includes('closed') || lower.includes('complete')) return 'Closed';
  if (lower.includes('progress') || lower.includes('assigned') || lower.includes('work')) return 'In Progress';
  if (lower.includes('resolved')) return 'Resolved';
  return 'Open';
}

function buildDescription(feature: Montgomery311Feature): string {
  const a = feature.attributes;
  const type = a.Request_Type ?? 'Service Request';
  const desc = a.Description  ?? '';
  const addr = a.Address       ?? '';

  if (desc) return `${type}: ${desc}`.slice(0, 500);
  if (addr) return `${type} reported at ${addr}`.slice(0, 500);
  return `${type} - Montgomery 311 Service Request #${a.OBJECTID}`;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  CityPulse AI — 311 Data Seed Script     ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Check data file exists
  if (!existsSync(DATA_FILE)) {
    console.error(`❌ Data file not found: ${DATA_FILE}`);
    console.error('');
    console.error('Please:');
    console.error('  1. Create the folder: backend/data/');
    console.error('  2. Save your downloaded JSON as: backend/data/montgomery311.json');
    console.error('');
    console.error('Download URL:');
    console.error('  https://gis.montgomeryal.gov/server/rest/services/HostedDatasets/Received_311_Service_Request/MapServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=10000');
    process.exit(1);
  }

  // Load categories from DB
  console.log('📋 Loading categories from Supabase...');
  const { data: categories, error: catErr } = await supabaseAdmin
    .from('categories')
    .select('id, name');

  if (catErr || !categories) {
    console.error('❌ Failed to load categories:', catErr?.message);
    process.exit(1);
  }

  const catMap: Record<string, number> = {};
  for (const cat of categories) catMap[cat.name] = cat.id;
  console.log(`✅ Loaded ${categories.length} categories\n`);

  // Parse the JSON file
  console.log(`📂 Reading: ${DATA_FILE}`);
  const raw  = readFileSync(DATA_FILE, 'utf-8');
  const json = JSON.parse(raw) as Montgomery311Response;

  const features = json.features ?? [];
  console.log(`📊 Found ${features.length} records in JSON file\n`);

  if (features.length === 0) {
    console.warn('⚠️  No features found. Check the JSON structure.');
    process.exit(0);
  }

  // Print sample to help debug field names
  console.log('🔍 Sample record attributes:');
  console.log(JSON.stringify(features[0]?.attributes, null, 2));
  console.log('');

  // Transform features → complaint rows
  const rows = features.map((f: Montgomery311Feature) => {
    const a        = f.attributes;
    const category = mapCategory(a.Request_Type);
    const catId    = catMap[category] ?? catMap['Other'] ?? null;

    // Coordinates: geometry.x/y (ESRI) or attributes Latitude/Longitude
    let lat: number | null = null;
    let lng: number | null = null;

    if (f.geometry?.y && f.geometry?.x) {
      lat = f.geometry.y;
      lng = f.geometry.x;
    } else if (a.Latitude && a.Longitude) {
      lat = Number(a.Latitude);
      lng = Number(a.Longitude);
    }

    // Sanity check: Montgomery is roughly 32°N, 86°W
    if (lat && (lat < 30 || lat > 35)) lat = null;
    if (lng && (lng < -90 || lng > -82)) lng = null;

    return {
      external_id:  String(a.OBJECTID),
      text:         buildDescription(f),
      location:     a.Address       ?? null,
      neighborhood: a.Neighborhood  ?? null,
      lat,
      lng,
      source:       'Montgomery 311',
      category_id:  catId,
      status:       mapStatus(a.Status),
      open_date:    a.Opened_Date ? new Date(a.Opened_Date).toISOString() : null,
      close_date:   a.Closed_Date  ? new Date(a.Closed_Date).toISOString()  : null,
      scraped_at:   new Date().toISOString(),
    };
  });

  // Insert in batches
  let totalInserted = 0;
  let totalUpdated  = 0;
  const batches = Math.ceil(rows.length / BATCH_SIZE);

  console.log(`⬆️  Upserting ${rows.length} records in ${batches} batches of ${BATCH_SIZE}...\n`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch     = rows.slice(i, i + BATCH_SIZE);
    const batchNum  = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`  Batch ${batchNum}/${batches}...`);

    const { error } = await supabaseAdmin
      .from('complaints')
      .upsert(batch, { onConflict: 'external_id' });

    if (error) {
      console.error(`\n❌ Batch ${batchNum} failed:`, error.message);
      console.error('First row in batch:', JSON.stringify(batch[0], null, 2));
    } else {
      totalInserted += batch.length;
      process.stdout.write(` ✅ (${totalInserted}/${rows.length})\n`);
    }
  }

  console.log('\n══════════════════════════════════════════');
  console.log(`✅ Seed complete!`);
  console.log(`   Records upserted: ${totalInserted}`);
  console.log('');
  console.log('Next step → run AI analysis on the data:');
  console.log('  npm run seed:analyze');
  console.log('══════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
