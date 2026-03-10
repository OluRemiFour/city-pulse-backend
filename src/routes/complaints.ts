// ============================================================
// routes/complaints.ts
// GET  /api/complaints        — paginated list with filters
// GET  /api/complaints/:id    — single complaint detail
// GET  /api/complaints/map    — all complaints with coords (for map)
// ============================================================

import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase.js';
import type { ComplaintWithAnalysis, ApiComplaint } from '../types/index.js';

export const complaintsRouter = Router();

// Helper: convert DB view row → frontend ApiComplaint shape
function toApiMapPin(complaint: ComplaintWithAnalysis) {
  return {
    id: complaint.id,
    latitude: complaint.lat,
    longitude: complaint.lng,
    category: complaint.category ?? 'Other',
    severity: complaint.severity,
    description: complaint.text,
    neighborhood: complaint.neighborhood,
  };
}

// Helper: convert DB view row → frontend ApiComplaint shape
function toApiComplaint(row: ComplaintWithAnalysis): ApiComplaint {
  const openDate = row.open_date ? new Date(row.open_date) : new Date(row.scraped_at);
  const now      = new Date();
  const diffMs   = now.getTime() - openDate.getTime();
  const diffHrs  = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHrs / 24);

  let timestamp: string;
  if (diffHrs < 1)        timestamp = 'Just now';
  else if (diffHrs < 24)  timestamp = `${diffHrs} hour${diffHrs > 1 ? 's' : ''} ago`;
  else if (diffDays === 1) timestamp = '1 day ago';
  else if (diffDays < 7)  timestamp = `${diffDays} days ago`;
  else                    timestamp = openDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return {
    id:               row.id,
    complaint_id:     row.external_id ?? undefined,
    description:      row.text,
    category:         row.category     ?? 'Other',
    severity:         (row.severity as 'High' | 'Medium' | 'Low' | null) ?? 'Low',
    address:          row.location     ?? 'Montgomery, AL',
    neighborhood:     row.neighborhood ?? 'Unknown',
    latitude:         row.lat,
    longitude:        row.lng,
    source:           row.source,
    status:           row.status,
    open_date:        openDate.toISOString().split('T')[0],
    close_date:       null, // Add this if available in row
    timestamp,
    ai_summary:       row.summary      ?? undefined,
    sentiment:        row.sentiment    ?? undefined,
    confidence_score: row.confidence_score ?? undefined,
  };
}

// ── GET /api/complaints ───────────────────────────────────────
// Query params:
//   page      (default 1)
//   limit     (default 50, max 200)
//   category  (Road Infrastructure | Waste Management | ...)
//   severity  (High | Medium | Low)
//   status    (Open | In Progress | Resolved | Closed)
//   source    (Montgomery 311 | Bright Data)
//   search    (text search on complaint text + location)
/*
  Insight Generation Fields:
  {
    "title": "Short insight title",
    "summary": "2-3 sentence analysis with specific numbers from the data",
    "severity": "High" | "Medium" | "Low",
    "recommendation": "One concrete action for city officials",
    "category": "Road Infrastructure" | "Waste Management" | "Traffic Problems" | "Utilities" | "Public Safety" | "General"
  }
*/
complaintsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page     as string) || 1);
    const limit    = Math.min(200, parseInt(req.query.limit  as string) || 50);
    const offset   = (page - 1) * limit;
    const category = req.query.category as string | undefined;
    const severity = req.query.severity as string | undefined;
    const status   = req.query.status   as string | undefined;
    const source   = req.query.source   as string | undefined;
    const search   = req.query.search   as string | undefined;

    let query = supabase
      .from('complaints_with_analysis')
      .select('*', { count: 'exact' })
      .order('open_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (category && category !== 'All') query = query.eq('category', category);
    if (severity && severity !== 'All') query = query.eq('severity', severity);
    if (status   && status   !== 'All') query = query.eq('status',   status);
    if (source   && source   !== 'All') query = query.eq('source',   source);
    if (search) {
      query = query.or(`text.ilike.%${search}%,location.ilike.%${search}%,neighborhood.ilike.%${search}%`);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    const complaints = (data as ComplaintWithAnalysis[]).map(toApiComplaint);

    res.json({
      data:       complaints,
      total:      count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((count ?? 0) / limit),
    });
  } catch (err) {
    console.error('[GET /complaints]', err);
    res.status(500).json({ error: 'Failed to fetch complaints' });
  }
});

// ── GET /api/complaints/map ───────────────────────────────────
// Lightweight endpoint — only fields needed for map pins
// No pagination, returns all records that have coordinates
complaintsRouter.get('/map', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('complaints_with_analysis')
      .select('id, text, location, neighborhood, lat, lng, category, severity, status, source')
      .not('lat', 'is', null)
      .not('lng', 'is', null)
      .order('open_date', { ascending: false })
      .limit(2000);

    if (error) throw error;
    
    const pins = (data as ComplaintWithAnalysis[]).map(toApiMapPin);
    res.json({ data: pins });
  } catch (err) {
    console.error('[GET /complaints/map]', err);
    res.status(500).json({ error: 'Failed to fetch map data' });
  }
});

// ── GET /api/complaints/:id ───────────────────────────────────
complaintsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('complaints_with_analysis')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Complaint not found' });
      return;
    }

    res.json({ data: toApiComplaint(data as ComplaintWithAnalysis) });
  } catch (err) {
    console.error('[GET /complaints/:id]', err);
    res.status(500).json({ error: 'Failed to fetch complaint' });
  }
});
