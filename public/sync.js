// NTP-style clock offset estimation. Works in the browser and in node (for tests).
// Keeps the lowest-latency samples because those have the least asymmetric error.
export class ClockSync {
  constructor({ keep = 12, best = 5 } = {}) {
    this.keep = keep;
    this.best = best;
    this.samples = [];
    this.offset = 0;
    this.rtt = Infinity;
    this.ready = false;
  }
  // clientSend/clientRecv: local ms timestamps; serverTime: server ms timestamp.
  addSample(clientSend, serverTime, clientRecv) {
    const rtt = clientRecv - clientSend;
    if (rtt < 0) return;
    const offset = serverTime - (clientSend + rtt / 2);
    this.samples.push({ rtt, offset });
    if (this.samples.length > this.keep) this.samples.shift();
    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, this.best);
    const offs = sorted.map((s) => s.offset).sort((a, b) => a - b);
    this.offset = offs[Math.floor(offs.length / 2)];
    this.rtt = sorted[0].rtt;
    this.ready = this.samples.length >= 3;
  }
  serverNow(clientNow = Date.now()) { return clientNow + this.offset; }
  toLocal(serverTime) { return serverTime - this.offset; }
  reset() { this.samples = []; this.offset = 0; this.rtt = Infinity; this.ready = false; }
}
