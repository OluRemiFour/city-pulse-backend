// ============================================================
// types/index.ts — Shared types matching Supabase schema
// These mirror the columns in the DB and the shape the
// frontend already uses via mockData.ts
// ============================================================

// ── Database row types ────────────────────────────────────────

export interface DBComplaint {
  id: string;                  // UUID
  external_id: string | null;  // Original 311 OBJECTID or scraper ID
  text: string;
  location: string | null;
  neighborhood: string | null;
  lat: number | null;
  lng: number | null;
  source: string;              // 'Montgomery 311' | 'Bright Data'
  category_id: number | null;
  status: 'Open' | 'In Progress' | 'Resolved' | 'Closed';
  open_date: string | null;
  close_date: string | null;
  scraped_at: string;
  created_at: string;
}

export interface DBAnalysis {
  id: string;
  complaint_id: string;
  severity: 'High' | 'Medium' | 'Low';
  summary: string;
  sentiment: 'Urgent' | 'Frustrated' | 'Neutral' | 'Informational';
  confidence_score: number;
  model_used: string;
  processed_at: string;
}

export interface DBCategory {
  id: number;
  name: string;
  description: string | null;
}

export interface DBScrapeJob {
  id: string;
  source: string;
  target_url: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  records_found: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

// ── View types (pre-joined) ───────────────────────────────────

export interface ComplaintWithAnalysis {
  id: string;
  external_id: string | null;
  text: string;
  location: string | null;
  neighborhood: string | null;
  lat: number | null;
  lng: number | null;
  source: string;
  status: string;
  open_date: string | null;
  scraped_at: string;
  category: string | null;     // From categories.name JOIN
  severity: string | null;     // From analysis.severity JOIN
  summary: string | null;
  sentiment: string | null;
  confidence_score: number | null;
  analyzed_at: string | null;
}

export interface StatsByCategory {
  category: string;
  total: number;
  analyzed: number;
  high: number;
  medium: number;
  low: number;
  open_count: number;
  resolved_count: number;
}

export interface DailyTrend {
  day: string;
  category: string;
  count: number;
}

export interface Hotspot {
  neighborhood: string;
  total: number;
  high_severity: number;
}

// ── Montgomery 311 API raw field types ────────────────────────

export interface Montgomery311Feature {
  attributes: {
    OBJECTID: number;
    Service_Request_Number?: string;
    Request_Type?: string;
    Description?: string;
    Status?: string;
    Address?: string;
    Neighborhood?: string;
    City?: string;
    State?: string;
    Zip_Code?: string;
    Opened_Date?: number;   // Unix ms timestamp
    Closed_Date?: number;
    Latitude?: number;
    Longitude?: number;
    [key: string]: unknown;
  };
  geometry?: {
    x: number;
    y: number;
  };
}

export interface Montgomery311Response {
  features: Montgomery311Feature[];
  exceededTransferLimit?: boolean;
}

// ── API response shapes (what Express sends to frontend) ─────

export interface ApiComplaint {
  id: string;
  complaint_id?: string;
  category: string;
  severity: 'High' | 'Medium' | 'Low' | null;
  description: string;
  address: string;
  neighborhood: string;
  latitude: number | null;
  longitude: number | null;
  source: string;
  status: string;
  open_date: string;
  close_date?: string | null;
  timestamp: string;
  ai_summary?: string;
  sentiment?: string;
  confidence_score?: number;
}

export interface ApiStats {
  totalComplaints: number;
  totalAnalyzed: number;
  byCategory: StatsByCategory[];
  recentTrend: DailyTrend[];
  hotspots: Hotspot[];
}

export interface ApiInsightRequest {
  question: string;
  context?: 'dashboard' | 'map' | 'complaints';
}

export interface ApiInsightResponse {
  answer: string;
  citations: string[];
  suggestedActions: string[];
}
