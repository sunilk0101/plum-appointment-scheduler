import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { HttpError } from '../errors';
import { appointmentsRouter } from './routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/', (_req, res) => {
    res.json({
      service: 'AI-Powered Appointment Scheduler',
      problem: 'Plum SDE Intern Assignment — Problem Statement 1',
      timezone: 'Asia/Kolkata',
      health: '/health',
      endpoints: [
        'POST /api/v1/extract',
        'POST /api/v1/entities',
        'POST /api/v1/normalize',
        'POST /api/v1/appointments',
        'POST /api/v1/pipeline',
      ],
    });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/v1', appointmentsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'Image exceeds the 5MB limit.' });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: 'Request body must be valid JSON.' });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : 'Unexpected error';
    res.status(500).json({ error: message });
  });

  return app;
}
