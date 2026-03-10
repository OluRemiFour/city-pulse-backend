// ============================================================
// routes/stats.ts
// GET /api/stats — all dashboard metric data in one call
//   returns: stat cards, trend chart data, hotspots, categories
// ============================================================

import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase.js';
import type { StatsByCategory, DailyTrend, Hotspot } from '../types/index.js';

export const statsRouter = Router();

statsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    // Run all 4 queries in parallel for speed
    const [categoriesRes, trendRes, hotspotsRes, recentRes] = await Promise.all([
      supabase.from('stats_by_category').select('*'),
      supabase.from('daily_trend').select('*'),
      supabase.from('hotspots').select('*'),
      supabase.from('complaints_with_analysis')
        .select('id, severity')
        .gte('open_date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    if (categoriesRes.error) throw categoriesRes.error;
    if (trendRes.error)      throw trendRes.error;
    if (hotspotsRes.error)   throw hotspotsRes.error;
    if (recentRes.error)     throw recentRes.error;

    const byCategory = (categoriesRes.data ?? []) as StatsByCategory[];
    const recentTrend = (trendRes.data ?? []) as DailyTrend[];
    const hotspots    = (hotspotsRes.data ?? []) as Hotspot[];
    const recent7     = recentRes.data ?? [];

    // Aggregate totals for stat cards
    const totalComplaints = byCategory.reduce((s, c) => s + Number(c.total),    0);
    const totalAnalyzed   = byCategory.reduce((s, c) => s + Number(c.analyzed), 0);
    const totalHigh       = byCategory.reduce((s, c) => s + Number(c.high),     0);

    // Weekly change (complaints in last 7 days vs prior 7 days)
    // We piggyback on trend data for this
    const trendByDay = recentTrend.reduce((acc: Record<string, number>, r) => {
      acc[r.day] = (acc[r.day] ?? 0) + Number(r.count);
      return acc;
    }, {});
    const sortedDays   = Object.keys(trendByDay).sort();
    const last7Total   = sortedDays.slice(-7).reduce((s, d)  => s + trendByDay[d], 0);
    const prior7Total  = sortedDays.slice(-14, -7).reduce((s, d) => s + trendByDay[d], 0);
    const weeklyChange = prior7Total > 0
      ? Math.round(((last7Total - prior7Total) / prior7Total) * 100)
      : 0;

    // Format trend chart for recharts (pivot category into columns per day)
    // Shape: [{ name: 'Mon', 'Road Infrastructure': 12, 'Waste Management': 8 }]
    const trendMap: Record<string, any> = {};
    for (const row of recentTrend) {
      const label = new Date(row.day).toLocaleDateString('en-US', { weekday: 'short' });
      if (!trendMap[row.day]) {
        trendMap[row.day] = { day: row.day, name: label };
      }
      trendMap[row.day][row.category] = Number(row.count);
    }
    const trendChart = Object.values(trendMap).sort((a, b) =>
      new Date(a.day).getTime() - new Date(b.day).getTime()
    );

    // Stat cards array — matches the STATS shape in mockData.ts
    const statCards = [
      {
        title:  'Total Complaints (All Time)',
        value:  totalComplaints,
        change: weeklyChange >= 0 ? `+${weeklyChange}%` : `${weeklyChange}%`,
      },
      ...byCategory.slice(0, 5).map(c => ({
        title:  c.category,
        value:  c.total,
        change: c.total > 0
          ? (c.high / c.total > 0.4 ? '+⚠ High risk' : 'Stable')
          : '—',
      })),
    ];

    // AI insights summary
    const topCategory  = byCategory[0];
    const mostUrgent   = byCategory.sort((a, b) => b.high - a.high)[0];
    const topHotspot   = hotspots[0];
    const aiInsights   = [
      {
        label: 'Top Issue This Week',
        value: topCategory?.category ?? 'N/A',
        icon:  'AlertTriangle',
      },
      {
        label: 'Highest Severity Area',
        value: mostUrgent
          ? `${mostUrgent.category} (${mostUrgent.high} high-severity)`
          : 'N/A',
        icon: 'TrendingUp',
      },
      {
        label: 'Most Affected Neighborhood',
        value: topHotspot?.neighborhood ?? 'N/A',
        icon:  'MapPin',
      },
    ];

    res.json({
      totalComplaints,
      totalAnalyzed,
      totalHigh,
      totalThisWeek: last7Total,
      weeklyChange,
      statCards,
      byCategory,
      trendChart,
      hotspots,
      aiInsights,
      recentSeverity: {
        high:   recent7.filter((c: any) => c.severity === 'High').length,
        medium: recent7.filter((c: any) => c.severity === 'Medium').length,
        low:    recent7.filter((c: any) => c.severity === 'Low').length,
      },
    });
  } catch (err) {
    console.error('[GET /stats]', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});
