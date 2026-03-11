// ============================================================
// index.ts — CityPulse AI Express Server
// Team Eagle | World Wide Vibes Hackathon
//
// Routes:
//   GET  /health                  — server health check
//   GET  /api/complaints          — paginated complaints list
//   GET  /api/complaints/map      — map pin data
//   GET  /api/complaints/:id      — single complaint
//   GET  /api/stats               — dashboard metrics
//   POST /api/insights            — ChatWidget AI Q&A
//   GET  /api/insights/auto       — AIInsightsPage cards
//   POST /api/insights/analyze    — batch AI analysis
//   POST /api/scrape              — trigger Bright Data
//   GET  /api/scrape/jobs         — scrape audit log
// ============================================================

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';

import { complaintsRouter } from './routes/complaints.js';
import { statsRouter       } from './routes/stats.js';
import { insightsRouter    } from './routes/insights.js';
import { scrapeRouter      } from './routes/scrape.js';
import { requestLogger     } from './middleware/logger.js';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = parseInt(process.env.PORT ?? '4000', 10);

// ── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:3000',   // Vite dev server
    'http://localhost:5173',   // Vite alt port
    /\.vercel\.app$/,          // Vercel previews
    /\.netlify\.app$/,         // Netlify previews
    /\.onrender\.com$/,        // OnRender previews/production
  ],
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));
app.use(requestLogger);

// ── Health check ──────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    service:   'CityPulse AI Backend',
    team:      'Team Eagle',
    hackathon: 'World Wide Vibes',
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ────────────────────────────────────────────────
app.use('/api/complaints', complaintsRouter);
app.use('/api/stats',      statsRouter);
app.use('/api/insights',   insightsRouter);
app.use('/api/scrape',     scrapeRouter);

// Serve static files from frontend build
// In production on Render: src/dist/index.js is running, frontend is in project root/frontend/dist
const FRONTEND_PATH = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(FRONTEND_PATH));

// Fallback route for SPA - serve index.html for any non-API request
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
    return next();
  }
  res.sendFile(path.join(FRONTEND_PATH, 'index.html'));
});
// ── 404 handler ───────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Error handler ─────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║       CityPulse AI Backend               ║');
  console.log('║       Team Eagle 🦅                      ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  http://localhost:${PORT}                    ║`);
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  Endpoints:                              ║');
  console.log(`║  GET  /health                            ║`);
  console.log(`║  GET  /api/complaints                    ║`);
  console.log(`║  GET  /api/stats                         ║`);
  console.log(`║  POST /api/insights                      ║`);
  console.log(`║  GET  /api/insights/auto                 ║`);
  console.log(`║  POST /api/scrape                        ║`);
  console.log(`║  GET  /api/scrape/jobs                   ║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
});

export default app;
