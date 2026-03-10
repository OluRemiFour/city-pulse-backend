// ============================================================
// middleware/logger.ts
// Simple HTTP request logger
// ============================================================

import { Request, Response, NextFunction } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on('finish', () => {
    const ms     = Date.now() - start;
    const status = res.statusCode;
    const color  =
      status >= 500 ? '\x1b[31m' :   // red
      status >= 400 ? '\x1b[33m' :   // yellow
      status >= 300 ? '\x1b[36m' :   // cyan
                      '\x1b[32m';    // green
    const reset  = '\x1b[0m';

    console.log(
      `${color}${status}${reset} ${req.method} ${req.originalUrl} — ${ms}ms`
    );
  });

  next();
}
