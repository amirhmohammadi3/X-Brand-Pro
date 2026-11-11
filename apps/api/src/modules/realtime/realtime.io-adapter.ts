import type { AppConfig } from '../../config/env.js';
// IoAdapter is constructor-instantiated by configureApp (not DI-scanned), so
// a value import is required — type-only would break at runtime.
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';
import type { INestApplicationContext } from '@nestjs/common';

/**
 * The single source of truth for the realtime transport path. Lives under
 * the API global prefix so reverse proxies that already forward
 * `/api/v1/*` to the API also forward the WebSocket upgrade — no extra
 * location block, no second origin to harden.
 */
export const REALTIME_WS_PATH = '/api/v1/socket.io';

/**
 * Custom Socket.IO adapter (B5.5) — the ONLY way to pass a config-derived
 * CORS policy into the WS server (decorator options are static). Mirrors the
 * HTTP CORS rule from configureApp: only the public web origin may connect,
 * credentials (cookies) allowed, no wildcard echo. The path override points
 * the handshake at `/api/v1/socket.io` (see REALTIME_WS_PATH).
 *
 * The FIRST constructor argument is load-bearing: AbstractWsAdapter resolves
 * the underlying http.Server from it (NestApplication → getUnderlyingHttpServer),
 * and IoAdapter.createIOServer attaches the io server to it. Passing anything
 * else (e.g. just the config) makes socket.io attach to a non-server and the
 * express port 404s every upgrade. Registered via
 * app.useWebSocketAdapter(new RealtimeIoAdapter(app, config)) in configureApp
 * — the same function both main.ts and the test helpers run, so tests
 * exercise the identical WS server setup as production.
 */
export class RealtimeIoAdapter extends IoAdapter {
  constructor(
    appOrHttpServer?: INestApplicationContext | object,
    private readonly config?: AppConfig,
  ) {
    super(appOrHttpServer);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    // `as ServerOptions`: the spread carries `adapter?: AdapterConstructor`
    // (optional through the base's own passthrough) while the target type
    // declares it non-optional — the base fills every unset field itself.
    return super.createIOServer(port, {
      ...options,
      serveClient: false,
      path: REALTIME_WS_PATH,
      cors: {
        origin: (origin, callback) => {
          if (!origin || origin === this.config?.publicWebUrl) return callback(null, true);
          return callback(null, false);
        },
        credentials: true,
        methods: ['GET', 'POST'],
      },
    } as ServerOptions);
  }
}
