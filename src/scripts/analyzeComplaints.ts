// ============================================================
// scripts/analyzeComplaints.ts
// Batch AI analysis of unanalyzed complaints using Gemini
//
// Usage:  npm run seed:analyze
// Safe to run multiple times — idempotent (skips already analyzed)
// Processes 50 at a time to respect rate limits
// ============================================================

import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { supabase, supabaseAdmin } from '../db/supabase.js';

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });
const GEMINI_MODEL = 'gemini-2.5-flash';
const BATCH_SIZE   = 50;
const DELAY_MS     = 1000; // Between each API call

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const status = err.status || (err.error && err.error.code);
      if (status === 503 || status === 429) {
        const wait = delay * Math.pow(2, i);
        console.warn(`\n    [AI Retry] Attempt ${i + 1} failed with ${status}. Retrying in ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function analyzeOne(complaint: {
  id: string;
  text: string;
  location: string | null;
  neighborhood: string | null;
  category: string | null;
}): Promise<{
  severity: string;
  summary: string;
  sentiment: string;
  confidence_score: number;
}> {
  const prompt = `Analyze this Montgomery, AL city complaint and return ONLY valid JSON (no markdown):

Category: ${complaint.category ?? 'Other'}
Location: ${complaint.location ?? 'Unknown'}
Neighborhood: ${complaint.neighborhood ?? 'Unknown'}
Text: "${complaint.text.slice(0, 400)}"

Return exactly:
{
  "severity": "High" | "Medium" | "Low",
  "summary": "One sentence under 120 chars summarizing the issue",
  "sentiment": "Urgent" | "Frustrated" | "Neutral" | "Informational",
  "confidence_score": 0.00 to 1.00
}

Severity guide:
- High: Safety risk, infrastructure failure, health hazard, or no resolution for 30+ days
- Medium: Ongoing nuisance, degraded service, requires attention within a week
- Low: Minor issue, cosmetic, or already being addressed`;

  return withRetry(async () => {
    const response = await (genai as any).models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: 250,
        temperature: 0.1,
      },
    });
    const raw = (response.text ?? '').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);
    return {
      severity:         ['High', 'Medium', 'Low'].includes(parsed.severity) ? parsed.severity : 'Low',
      summary:          (parsed.summary ?? complaint.text.slice(0, 120)),
      sentiment:        ['Urgent', 'Frustrated', 'Neutral', 'Informational'].includes(parsed.sentiment)
        ? parsed.sentiment : 'Neutral',
      confidence_score: Math.min(1, Math.max(0, Number(parsed.confidence_score) || 0.75)),
    };
  });
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  CityPulse AI — Complaint Analyzer       ║');
  console.log('╚══════════════════════════════════════════╝\n');

  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY not set in .env');
    process.exit(1);
  }

  // Count total unanalyzed
  const { count: totalUnanalyzed } = await supabase
    .from('complaints')
    .select('id, analysis!left(id)', { count: 'exact', head: true })
    .is('analysis', null);

  console.log(`📊 Unanalyzed complaints: ${totalUnanalyzed ?? '?'}`);
  console.log(`⚡ Processing up to ${BATCH_SIZE} per run\n`);

  // Fetch a batch of unanalyzed complaints (with their category name via view)
  const { data: unanalyzed, error } = await supabase
    .from('complaints_with_analysis')
    .select('id, text, location, neighborhood, category')
    .is('severity', null)
    .limit(BATCH_SIZE);

  if (error) {
    console.error('❌ Failed to fetch complaints:', error.message);
    process.exit(1);
  }

  if (!unanalyzed || unanalyzed.length === 0) {
    console.log('✅ All complaints are already analyzed!');
    return;
  }

  console.log(`🤖 Analyzing ${unanalyzed.length} complaints with Gemini ${GEMINI_MODEL}...\n`);

  let ok    = 0;
  let fails = 0;

  for (let i = 0; i < unanalyzed.length; i++) {
    const complaint = unanalyzed[i];
    process.stdout.write(`  [${i + 1}/${unanalyzed.length}] ${complaint.id.slice(0, 8)}… `);

    try {
      const result = await analyzeOne(complaint as any);

      const { error: upsertErr } = await supabaseAdmin
        .from('analysis')
        .upsert({
          complaint_id:     complaint.id,
          severity:         result.severity,
          summary:          result.summary,
          sentiment:        result.sentiment,
          confidence_score: result.confidence_score,
          model_used:       GEMINI_MODEL,
          processed_at:     new Date().toISOString(),
        }, { onConflict: 'complaint_id' });

      if (upsertErr) throw new Error(upsertErr.message);

      console.log(`✅ ${result.severity} — ${result.summary.slice(0, 60)}…`);
      ok++;
    } catch (err: any) {
      console.log(`❌ ${err.message}`);
      fails++;
    }

    // Rate limit delay
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  const remaining = (totalUnanalyzed ?? 0) - ok;

  console.log('\n══════════════════════════════════════════');
  console.log(`✅ Analysis complete!`);
  console.log(`   Processed: ${ok}`);
  console.log(`   Failed:    ${fails}`);
  if (remaining > 0) {
    console.log(`   Remaining: ~${remaining} — run npm run seed:analyze again`);
  } else {
    console.log(`   All complaints analyzed! 🎉`);
  }
  console.log('══════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
