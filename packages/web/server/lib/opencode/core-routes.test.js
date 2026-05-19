import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerCommonRequestMiddleware, registerServerStatusRoutes } from './core-routes.js';

describe('core-routes', () => {
  it('should call gracefulShutdown with exitProcess: true on /api/system/shutdown', async () => {
    const app = express();
    let shutdownOpts = null;
    const dependencies = {
      express,
      process,
      gracefulShutdown: vi.fn(async (opts) => {
        shutdownOpts = opts;
      }),
      getHealthSnapshot: () => ({ status: 'ok' }),
      openchamberVersion: '1.0.0',
      runtimeName: 'test',
    };

    registerServerStatusRoutes(app, dependencies);

    await request(app).post('/api/system/shutdown');

    expect(dependencies.gracefulShutdown).toHaveBeenCalled();
    expect(shutdownOpts).toEqual({ exitProcess: true });
  });

  it('parses JSON bodies for provider management routes', async () => {
    const app = express();
    registerCommonRequestMiddleware(app, { express });

    app.post('/api/provider/custom', (req, res) => {
      res.json({ body: req.body ?? null });
    });

    const response = await request(app)
      .post('/api/provider/custom')
      .send({
        id: 'my-provider',
        apiKey: 'sk-test',
      })
      .expect(200);

    expect(response.body).toEqual({
      body: {
        id: 'my-provider',
        apiKey: 'sk-test',
      },
    });
  });

  it('parses JSON bodies for provider auth routes', async () => {
    const app = express();
    registerCommonRequestMiddleware(app, { express });

    app.put('/api/auth/my-provider', (req, res) => {
      res.json({ body: req.body ?? null });
    });

    const response = await request(app)
      .put('/api/auth/my-provider')
      .send({
        type: 'api',
        key: 'sk-test',
      })
      .expect(200);

    expect(response.body).toEqual({
      body: {
        type: 'api',
        key: 'sk-test',
      },
    });
  });

  it('parses JSON bodies for Smart Search routes', async () => {
    const app = express();
    registerCommonRequestMiddleware(app, { express });

    app.patch('/api/smart-search/config', (req, res) => {
      res.json({ body: req.body ?? null });
    });

    const response = await request(app)
      .patch('/api/smart-search/config')
      .send({
        set: { XAI_MODEL: 'grok-4-fast' },
        unset: ['EXA_API_KEY'],
      })
      .expect(200);

    expect(response.body).toEqual({
      body: {
        set: { XAI_MODEL: 'grok-4-fast' },
        unset: ['EXA_API_KEY'],
      },
    });
  });
});
