/**
 * WebSocket server.
 * Clients must send { type: 'auth', token: '<jwt>' } as their first message.
 * On success: server replies { type: 'auth_ok' }.
 * Exposes broadcast(event, payload) for use by ingest routes.
 */
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');

let wss = null;
const authenticated = new Set();

function getVerifyKey() {
  if (process.env.JWT_PUBLIC_KEY && process.env.JWT_PUBLIC_KEY.startsWith('-----BEGIN')) {
    return { key: process.env.JWT_PUBLIC_KEY, algorithms: ['RS256'] };
  }
  return { key: process.env.JWT_SECRET || 'dev-secret-change-me', algorithms: ['HS256'] };
}

function init(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let authed = false;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (!authed) {
          if (msg.type === 'auth' && msg.token) {
            const { key, algorithms } = getVerifyKey();
            try {
              jwt.verify(msg.token, key, { algorithms });
              authed = true;
              authenticated.add(ws);
              ws.send(JSON.stringify({ type: 'auth_ok' }));
            } catch {
              ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid token' }));
              ws.close();
            }
          } else {
            ws.send(JSON.stringify({ type: 'auth_error', error: 'Authenticate first' }));
            ws.close();
          }
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      authenticated.delete(ws);
    });

    ws.on('error', () => {
      authenticated.delete(ws);
    });
  });

  console.log('WebSocket server ready');
  return wss;
}

function broadcast(event, payload) {
  if (!wss) return;
  const message = JSON.stringify({ type: event, ...payload });
  for (const client of authenticated) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(message);
    }
  }
}

module.exports = { init, broadcast };
