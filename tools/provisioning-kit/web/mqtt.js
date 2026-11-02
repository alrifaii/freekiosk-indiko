// MqttLite: minimal MQTT 3.1.1 client over WebSocket for the kit's Tablets view.
// QoS 0 publish and subscribe, keepalive, reconnect with backoff. Incoming QoS 1/2
// messages are acknowledged, so it also works with brokers that upgrade QoS.
(function (root) {
  "use strict";
  const te = new TextEncoder();
  const td = new TextDecoder();

  const CONNACK_TEXT = {
    1: "Protokoll abgelehnt",
    2: "Client-ID abgelehnt",
    3: "Server nicht verfügbar",
    4: "Benutzer oder Passwort falsch",
    5: "Nicht berechtigt",
  };

  function cat(parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  function mstr(s) {
    const b = te.encode(s);
    const o = new Uint8Array(2 + b.length);
    o[0] = b.length >> 8; o[1] = b.length & 255; o.set(b, 2);
    return o;
  }
  function remLen(n) {
    const out = [];
    do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0);
    return Uint8Array.from(out);
  }
  function packet(header, body) { return cat([Uint8Array.of(header), remLen(body.length), body]); }

  class MqttLite {
    constructor(opts) {
      this.o = Object.assign({ keepalive: 30, clientId: "kit-" + Math.random().toString(16).slice(2, 10) }, opts);
      this.handlers = {};
      this.subs = [];
      this.buf = new Uint8Array(0);
      this.pid = 0;
      this.state = "closed";
      this.closed = true;
      this.retry = 1000;
      this.reason = "";
    }
    on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); return this; }
    emit(ev, ...args) {
      for (const fn of this.handlers[ev] || []) { try { fn(...args); } catch (e) { console.error(e); } }
    }
    setState(s, detail) { this.state = s; this.emit("state", s, detail || ""); }

    connect() {
      this.closed = false;
      clearTimeout(this.retryTimer);
      let ws;
      try { ws = new WebSocket(this.o.url, ["mqtt"]); } catch (e) {
        this.setState("offline", "Adresse ungültig");
        return this.schedule();
      }
      this.ws = ws;
      ws.binaryType = "arraybuffer";
      this.buf = new Uint8Array(0);
      this.setState("connecting");
      ws.onopen = () => ws.send(this.connectPacket());
      ws.onmessage = (ev) => { if (ev.data instanceof ArrayBuffer) this.feed(new Uint8Array(ev.data)); };
      ws.onerror = () => {};
      ws.onclose = () => {
        clearInterval(this.pingTimer);
        if (this.ws === ws) this.ws = null;
        if (this.closed) return;
        this.setState("offline", this.reason || "keine Verbindung");
        this.reason = "";
        this.schedule();
      };
      return this;
    }
    schedule() {
      if (this.closed) return;
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 30000);
    }
    end() {
      this.closed = true;
      clearTimeout(this.retryTimer);
      clearInterval(this.pingTimer);
      const ws = this.ws;
      this.ws = null;
      if (ws) {
        try { if (ws.readyState === 1) ws.send(Uint8Array.of(0xe0, 0)); } catch (e) {}
        try { ws.close(); } catch (e) {}
      }
      this.setState("closed");
    }

    connectPacket() {
      let flags = 0x02; // clean session
      const payload = [mstr(this.o.clientId)];
      if (this.o.username) { flags |= 0x80; payload.push(mstr(this.o.username)); }
      if (this.o.password) { flags |= 0x40; payload.push(mstr(this.o.password)); }
      const ka = this.o.keepalive;
      return packet(0x10, cat([mstr("MQTT"), Uint8Array.of(4, flags, ka >> 8, ka & 255), ...payload]));
    }

    feed(chunk) {
      this.buf = this.buf.length ? cat([this.buf, chunk]) : chunk;
      for (;;) {
        const b = this.buf;
        if (b.length < 2) return;
        let len = 0, mul = 1, i = 1, done = false;
        for (; i < Math.min(b.length, 5); i++) {
          len += (b[i] & 127) * mul;
          mul *= 128;
          if (!(b[i] & 128)) { done = true; i++; break; }
        }
        if (!done) {
          if (b.length >= 5) { this.reason = "Ungültige Daten"; try { this.ws.close(); } catch (e) {} this.buf = new Uint8Array(0); }
          return;
        }
        const total = i + len;
        if (b.length < total) return;
        const header = b[0];
        const body = b.slice(i, total);
        this.buf = b.slice(total);
        this.handle(header, body);
      }
    }

    handle(header, body) {
      const type = header >> 4;
      if (type === 2) { // CONNACK
        const rc = body[1];
        if (rc !== 0) {
          this.reason = CONNACK_TEXT[rc] || "Abgelehnt (" + rc + ")";
          try { this.ws.close(); } catch (e) {}
          return;
        }
        this.retry = 1000;
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.send(Uint8Array.of(0xc0, 0)), Math.max(5, this.o.keepalive * 0.8) * 1000);
        this.setState("online");
        if (this.subs.length) this.sendSubscribe(this.subs);
      } else if (type === 3) { // PUBLISH
        const qos = (header >> 1) & 3;
        const tl = (body[0] << 8) | body[1];
        const topic = td.decode(body.subarray(2, 2 + tl));
        let p = 2 + tl;
        if (qos > 0) {
          const hi = body[p], lo = body[p + 1];
          p += 2;
          this.send(Uint8Array.of(qos === 1 ? 0x40 : 0x50, 2, hi, lo)); // PUBACK / PUBREC
        }
        this.emit("message", topic, body.slice(p), !!(header & 1));
      } else if (type === 6) { // PUBREL -> PUBCOMP
        this.send(Uint8Array.of(0x70, 2, body[0], body[1]));
      } else if (type === 9) { // SUBACK
        for (let i = 2; i < body.length; i++) {
          if (body[i] === 0x80) this.emit("state", this.state, "Abo abgelehnt");
        }
      }
    }

    send(bytes) {
      const ws = this.ws;
      if (ws && ws.readyState === 1) { ws.send(bytes); return true; }
      return false;
    }
    nextId() { this.pid = (this.pid % 65535) + 1; return this.pid; }
    subscribe(topics) {
      const fresh = topics.filter((t) => !this.subs.includes(t));
      this.subs.push(...fresh);
      if (this.state === "online" && fresh.length) this.sendSubscribe(fresh);
    }
    sendSubscribe(topics) {
      const id = this.nextId();
      const parts = [Uint8Array.of(id >> 8, id & 255)];
      for (const t of topics) parts.push(mstr(t), Uint8Array.of(0));
      this.send(packet(0x82, cat(parts)));
    }
    publish(topic, payload, opts) {
      const retain = !!(opts && opts.retain);
      const data = typeof payload === "string" ? te.encode(payload) : payload;
      return this.send(packet(0x30 | (retain ? 1 : 0), cat([mstr(topic), data])));
    }
  }

  root.MqttLite = MqttLite;
  if (typeof module !== "undefined") module.exports = { MqttLite };
})(typeof window !== "undefined" ? window : globalThis);
