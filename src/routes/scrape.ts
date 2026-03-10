// ============================================================
// routes/scrape.ts
// POST /api/scrape        — trigger Bright Data scrape
// GET  /api/scrape/jobs   — list scrape audit log (for judges)
// ============================================================

import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase.js';
import { runAllScrapes } from '../services/brightdata.js';

export const scrapeRouter = Router();

// POST /api/scrape — kick off a full scrape run
scrapeRouter.post('/', async (_req: Request, res: Response) => {
  // Fire-and-forget so response returns immediately
  res.json({ message: 'Scrape started. Check /api/scrape/jobs for status.' });

  // Run async — errors logged internally
  runAllScrapes().catch(err =>
    console.error('[POST /scrape] Unhandled error:', err)
  );
});

// GET /api/scrape/jobs — shows judges real Bright Data activity
scrapeRouter.get('/jobs', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('scrape_jobs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json({ data: data ?? [] });
  } catch (err) {
    console.error('[GET /scrape/jobs]', err);
    res.status(500).json({ error: 'Failed to fetch scrape jobs' });
  }
});
