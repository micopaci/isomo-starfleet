import type { WsEvent } from './types';

type EventHandler<T> = (payload: T) => void;
type Handlers = { [K in WsEvent['type']]?: EventHandler<Extract<WsEvent, { type: K }>>[] };

export class StarfleetWS {
  private url = '';
  private token = '';
  private ws: WebSocket | null = null;
  private handlers: Handlers = {};
  private reconnectDelay = 1000;
  private readonly maxDelay = 30000;
  private shouldReconnect = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(url: string, token: string): void {
    this.url = url;
    this.token = token;
    this.shouldReconnect = true;
    this.reconnectDelay = 1000;
    this._connect();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  on<K extends WsEvent['type']>(
    eventType: K,
    handler: EventHandler<Extract<WsEvent, { type: K }>>,
  ): () => void {
    if (!this.handlers[eventType]) {
      (this.handlers as Record<string, unknown[]>)[eventType] = [];
    }
    (this.handlers[eventType] as EventHandler<Extract<WsEvent, { type: K }>>[]).push(handler);

    // Return unsubscribe fn
    return () => {
      const arr = this.handlers[eventType] as EventHandler<Extract<WsEvent, { type: K }>>[];
      const idx = arr.indexOf(handler);
      if (idx !== -1) arr.splice(idx, 1);
    };
  }

  private _connect(): void {
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 1000; // reset on success
      this.ws!.send(JSON.stringify({ type: 'auth', token: this.token }));
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as WsEvent & { type: string };
        const arr = (this.handlers as Record<string, EventHandler<WsEvent>[]>)[msg.type];
        if (arr) arr.forEach((h) => h(msg as Extract<WsEvent, { type: typeof msg.type }>));
      } catch { /* ignore malformed messages */ }
    };

    this.ws.onclose = () => {
      if (this.shouldReconnect) this._scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private _scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      this._connect();
      // Exponential backoff: 1s → 2s → 4s → … → 30s
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
    }, this.reconnectDelay);
  }
}
