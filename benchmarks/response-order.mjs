// A release gate, not a timer-based approximation of response order. A test must
// observe each request before choosing when its response may complete.
export class ResponseOrder {
  constructor() { this.entries = new Map(); this.waiters = new Map(); this.labels = []; this.events = []; }

  begin(labels) {
    if (this.labels.length || [...this.entries.values()].some(entry => !entry.done)) throw new Error("Previous controlled responses have not completed");
    if (!Array.isArray(labels) || !labels.length || labels.some(id => typeof id !== "string" || !id) || new Set(labels).size !== labels.length) {
      throw new Error("Response labels must be unique non-empty strings");
    }
    this.entries.clear(); this.labels = [...labels]; this.events = [];
  }

  async holdNext(deliver) {
    const label = this.labels.shift();
    if (!label) return false;
    let finish;
    const completion = new Promise(resolve => { finish = resolve; });
    this.entries.set(label, { deliver, finish, done: false, releasing: false });
    this.events.push({ event: "request-held", label, at: Date.now() });
    for (const resolve of this.waiters.get(label) || []) resolve();
    this.waiters.delete(label);
    await completion;
    return true;
  }

  async waitFor(label, timeout = 5000) {
    if (this.entries.has(label)) return;
    await new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        const remaining = (this.waiters.get(label) || []).filter(waiter => waiter !== done);
        if (remaining.length) this.waiters.set(label, remaining); else this.waiters.delete(label);
        reject(new Error(`Controlled request ${label} did not arrive within ${timeout}ms`));
      }, timeout);
      this.waiters.set(label, [...(this.waiters.get(label) || []), done]);
    });
  }

  async release(label) {
    const entry = this.entries.get(label);
    if (!entry || entry.done || entry.releasing) throw new Error(`Controlled response ${label} is not pending`);
    entry.releasing = true;
    try {
      await entry.deliver(label);
      this.events.push({ event: "response-released", label, at: Date.now() });
    } catch (error) {
      this.events.push({ event: "response-release-failed", label, at: Date.now(), message: String(error.message) });
      throw error;
    } finally { entry.done = true; entry.finish(); }
  }

  async drain() {
    if (this.labels.length) this.events.push({ event: "plan-abandoned", labels: [...this.labels], at: Date.now() });
    this.labels = [];
    for (const [label, entry] of this.entries) {
      if (!entry.done && !entry.releasing) await this.release(label);
    }
  }
}
