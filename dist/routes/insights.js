// ============================================================
// routes/insights.ts
// POST /api/insights         — ChatWidget: ask a question
// GET  /api/insights/auto    — AIInsightsPage: generated insights
// POST /api/insights/analyze — trigger AI analysis on unanalyzed complaints
// ============================================================
import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import { supabase, supabaseAdmin } from "../db/supabase.js";
export const insightsRouter = Router();
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });
const GEMINI_MODEL = "gemini-2.5-flash";
async function withRetry(fn, retries = 3, delay = 1000) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        }
        catch (err) {
            lastErr = err;
            const status = err.status || (err.error && err.error.code);
            // Retry on 503 (Overloaded) or 429 (Rate Limit)
            if (status === 503 || status === 429) {
                const wait = delay * Math.pow(2, i);
                console.warn(`[AI Retry] Attempt ${i + 1} failed with ${status}. Retrying in ${wait}ms...`);
                await new Promise(r => setTimeout(r, wait));
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}
async function generateText(systemPrompt, userPrompt, maxTokens = 400) {
    return withRetry(async () => {
        const response = await genai.models.generateContent({
            model: GEMINI_MODEL,
            contents: userPrompt,
            config: {
                systemInstruction: systemPrompt,
                maxOutputTokens: maxTokens,
                temperature: 0.3,
            },
        });
        return response.text ?? "";
    });
}
async function generateJSON(prompt, maxTokens = 1200) {
    return withRetry(async () => {
        const response = await genai.models.generateContent({
            model: GEMINI_MODEL,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
                maxOutputTokens: maxTokens,
                temperature: 0.2,
            },
        });
        return response.text ?? "[]";
    });
}
// ── POST /api/insights ────────────────────────────────────────
// Body: { question: string, context?: string }
// Powers the ChatWidget with real data context
insightsRouter.post("/", async (req, res) => {
    try {
        const { question } = req.body;
        if (!question?.trim()) {
            res.status(400).json({ error: "question is required" });
            return;
        }
        // Fetch live stats to give Claude real context
        const [statsRes, recentRes, hotspotsRes] = await Promise.all([
            supabase.from("stats_by_category").select("*"),
            supabase
                .from("complaints_with_analysis")
                .select("text, category, severity, neighborhood, status, open_date")
                .order("open_date", { ascending: false })
                .limit(20),
            supabase.from("hotspots").select("*").limit(5),
        ]);
        const stats = statsRes.data ?? [];
        const recent = recentRes.data ?? [];
        const hotspots = hotspotsRes.data ?? [];
        const contextBlock = `
You are CityPulse AI, an intelligent assistant for Montgomery, Alabama city officials.
You help analyze citizen complaints and provide actionable recommendations.

CURRENT LIVE DATA:
─ Complaints by Category:
${stats.map((s) => `  • ${s.category}: ${s.total} total (${s.high} high-severity)`).join("\n")}

─ Top Complaint Hotspots:
${hotspots.map((h) => `  • ${h.neighborhood}: ${h.total} complaints (${h.high_severity} high-severity)`).join("\n")}

─ 20 Most Recent Complaints:
${recent.map((c) => `  [${c.severity ?? "Unknown"}] ${c.category ?? "Other"} — ${(c.text ?? "").slice(0, 80)} (${c.neighborhood ?? "Unknown"})`).join("\n")}

INSTRUCTIONS:
- Answer based on the real data above
- Be specific, cite numbers where relevant
- Keep answers concise (2–4 sentences)
- End with one concrete action city officials can take
- If you recommend escalation, specify the department
`.trim();
        const answer = (await generateText(contextBlock, question, 400)) ||
            "Unable to generate a response at this time.";
        res.json({ answer, dataTimestamp: new Date().toISOString() });
    }
    catch (err) {
        console.error("[POST /insights]", err);
        res.status(500).json({ error: "AI insight generation failed" });
    }
});
// ── GET /api/insights/auto ────────────────────────────────────
// Generates 3–5 rich insight cards for the AIInsightsPage
// Cached: re-generates only if data is stale (>30 min)
let insightCache = null;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
insightsRouter.get("/auto", async (_req, res) => {
    try {
        // Return cache if fresh
        if (insightCache && Date.now() - insightCache.generatedAt < CACHE_TTL_MS) {
            res.json({ data: insightCache.data, cached: true });
            return;
        }
        console.log("[GET /insights/auto] Fetching data from Supabase...");
        const [statsRes, trendRes, hotspotsRes, highRes] = await Promise.all([
            supabase.from("stats_by_category").select("*"),
            supabase.from("daily_trend").select("*").limit(70),
            supabase.from("hotspots").select("*"),
            supabase
                .from("complaints_with_analysis")
                .select("text, category, neighborhood, location, open_date")
                .eq("severity", "High")
                .order("open_date", { ascending: false })
                .limit(10),
        ]);
        console.log("[GET /insights/auto] Data counts: stats:", statsRes.data?.length, "trend:", trendRes.data?.length, "hotspots:", hotspotsRes.data?.length, "high:", highRes.data?.length);
        const prompt = `
You are an AI civic intelligence analyst for Montgomery, Alabama.
Analyze the following real complaint data and generate 4 actionable insight cards for city officials.

STATS BY CATEGORY:
${JSON.stringify(statsRes.data, null, 2)}

DAILY TREND (last 30 days):
${JSON.stringify(trendRes.data, null, 2)}

TOP HOTSPOT NEIGHBORHOODS:
${JSON.stringify(hotspotsRes.data, null, 2)}

HIGH SEVERITY COMPLAINTS:
${JSON.stringify(highRes.data, null, 2)}

Return ONLY valid JSON — an array of exactly 4 objects with this shape:
[
  {
    "title": "Short insight title",
    "summary": "2-3 sentence analysis with specific numbers from the data",
    "severity": "High" | "Medium" | "Low",
    "recommendation": "One concrete action for city officials",
    "category": "Road Infrastructure" | "Waste Management" | "Traffic Problems" | "Utilities" | "Public Safety" | "General"
  }
]
No markdown, no code fences, just the raw JSON array.
`.trim();
        // Bust cache for manual intervention if needed
        // insightCache = null; 
        let raw;
        try {
            raw = await generateJSON(prompt, 1200);
        }
        catch (err) {
            console.error("[GET /insights/auto] AI Generation failed, checking cache...", err);
            if (insightCache) {
                console.log("[GET /insights/auto] Serving stale cached data due to API error.");
                res.json({ data: insightCache.data, cached: true, error: "stale_due_to_api_error" });
                return;
            }
            throw err; // Re-throw if no cache available
        }
        let insights;
        try {
            insights = JSON.parse(raw.replace(/```json|```/g, "").trim());
            if (!Array.isArray(insights))
                insights = [];
        }
        catch {
            insights = [];
        }
        insightCache = { data: insights, generatedAt: Date.now() };
        res.json({ data: insights, cached: false });
    }
    catch (err) {
        console.error("[GET /insights/auto]", err);
        res.status(500).json({ error: "Auto-insight generation failed" });
    }
});
// ── POST /api/insights/analyze ────────────────────────────────
// Batch-analyzes unanalyzed complaints (up to 20 at a time)
// Called by the seed script and can be hit manually
insightsRouter.post("/analyze", async (_req, res) => {
    try {
        // Find complaints with no analysis row yet
        const { data: unanalyzed, error } = await supabase
            .from("complaints")
            .select(`
        id, text, location, neighborhood,
        categories!inner(name),
        analysis!left(id)
      `)
            .is("analysis", null)
            .limit(20);
        if (error)
            throw error;
        if (!unanalyzed || unanalyzed.length === 0) {
            res.json({
                message: "All complaints are already analyzed",
                processed: 0,
            });
            return;
        }
        const results = [];
        for (const complaint of unanalyzed) {
            try {
                const cat = complaint.categories?.name ?? "Other";
                const analyzePrompt = `Analyze this Montgomery, AL city complaint:
Category: ${cat}
Location: ${complaint.location ?? "Unknown"}
Neighborhood: ${complaint.neighborhood ?? "Unknown"}
Text: "${complaint.text}"

Respond ONLY with valid JSON (no markdown):
{
  "severity": "High" | "Medium" | "Low",
  "summary": "One sentence summary under 120 chars",
  "sentiment": "Urgent" | "Frustrated" | "Neutral" | "Informational",
  "confidence_score": 0.00-1.00
}`;
                const raw = await generateJSON(analyzePrompt, 250);
                const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
                await supabaseAdmin.from("analysis").upsert({
                    complaint_id: complaint.id,
                    severity: parsed.severity ?? "Low",
                    summary: parsed.summary ?? complaint.text.slice(0, 120),
                    sentiment: parsed.sentiment ?? "Neutral",
                    confidence_score: parsed.confidence_score ?? 0.75,
                    model_used: GEMINI_MODEL,
                    processed_at: new Date().toISOString(),
                }, { onConflict: "complaint_id" });
                results.push({ id: complaint.id, status: "ok" });
                // Small delay to respect rate limits
                await new Promise((r) => setTimeout(r, 200));
            }
            catch (innerErr) {
                console.error(`  Failed to analyze ${complaint.id}:`, innerErr);
                results.push({ id: complaint.id, status: "error" });
            }
        }
        // Bust insight cache so next request gets fresh data
        insightCache = null;
        res.json({ processed: results.length, results });
    }
    catch (err) {
        console.error("[POST /insights/analyze]", err);
        res.status(500).json({ error: "Batch analysis failed" });
    }
});
