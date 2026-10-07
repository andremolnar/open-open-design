import express, { type Express, type Request } from 'express';
import {
  ATTRIBUTION_CLAIM_PATH,
  type AttributionClaimResponse,
  type AttributionClaimSource,
} from '@open-design/contracts';
import type { AnalyticsService } from '../analytics.js';
import type { AppConfigPrefs } from '../app-config.js';

type ReadAppConfig = (dataDir: string) => Promise<AppConfigPrefs>;

export interface AttributionService {
  claim(input: AttributionClaimInput): Promise<AttributionClaimResponse>;
  processPending(): Promise<AttributionClaimResponse | null>;
  bridgeUrl(url: string): Promise<string | null>;
}

export interface AttributionClaimInput {
  token?: string | null;
  source: AttributionClaimSource;
  rawUrl?: string | null;
  platform?: string | null;
}

export interface RegisterAttributionRoutesDeps {
  analytics: AnalyticsService;
  env?: NodeJS.ProcessEnv;
  http: {
    isLocalSameOrigin: (req: Request, port: number) => boolean;
    resolvedPortRef: { current: number };
  };
  paths: {
    RUNTIME_DATA_DIR: string;
  };
  appConfig: {
    readAppConfig: ReadAppConfig;
  };
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

export function createAttributionService(_deps: Omit<RegisterAttributionRoutesDeps, 'http'>): AttributionService {
  const service: AttributionService = {
    async claim(input) {
      const token = normalizeToken(input.token);
      if (!token) {
        return response('invalid');
      }
      return response('not_found');
    },
    async processPending() {
      // Installer provenance is local metadata in a detached distribution.
      // Never contact the upstream token ledger during startup recovery.
      return null;
    },
    async bridgeUrl(url) {
      void url;
      return null;
    },
  };

  return service;
}

export function registerAttributionRoutes(app: Express, deps: RegisterAttributionRoutesDeps): AttributionService {
  const service = createAttributionService(deps);
  app.post(ATTRIBUTION_CLAIM_PATH, express.json({ limit: '16kb' }), async (req, res) => {
    if (!deps.http.isLocalSameOrigin(req, deps.http.resolvedPortRef.current)) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const parsed = parseClaimRequest(req.body);
    if (!parsed) {
      return res.status(400).json(response('invalid'));
    }
    try {
      res.json(await service.claim(parsed));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  app.post('/api/attribution/bridge-url', express.json({ limit: '8kb' }), async (req, res) => {
    if (!deps.http.isLocalSameOrigin(req, deps.http.resolvedPortRef.current)) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const url = req.body && typeof req.body === 'object' && typeof req.body.url === 'string'
      ? req.body.url
      : null;
    if (!url) return res.status(400).json({ error: 'invalid_url' });
    res.json({ url: await service.bridgeUrl(url) });
  });
  return service;
}

function parseClaimRequest(body: unknown): AttributionClaimInput | null {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  if (!isSource(obj.source)) return null;
  const platform = typeof obj.platform === 'string' ? obj.platform : null;
  return {
    source: obj.source,
    token: typeof obj.token === 'string' ? obj.token : null,
    rawUrl: typeof obj.rawUrl === 'string' ? obj.rawUrl : null,
    platform,
  };
}

function isSource(value: unknown): value is AttributionClaimSource {
  return value === 'mac_where_froms'
    || value === 'windows_zone_identifier'
    || value === 'installer_observation_file'
    || value === 'manual';
}

function normalizeToken(value: unknown): string | null {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(cleaned)) return null;
  return cleaned;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function response(
  status: AttributionClaimResponse['status'],
  overrides: Partial<Omit<AttributionClaimResponse, 'ok' | 'status'>> = {},
): AttributionClaimResponse {
  return {
    ok: true,
    status,
    found: false,
    pending: false,
    merged: false,
    ...overrides,
  };
}
