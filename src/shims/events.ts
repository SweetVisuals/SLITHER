// Custom events shim that ensures default and named export compatibility.
// The Particle AA SDK does `import EventEmitter from "events"` (default import)
// but also some internal code does `class X extends events.EventEmitter`.
// This shim handles both patterns by re-exporting EventEmitter correctly.

// Use a CJS-compatible approach: require the actual polyfill at runtime
// This avoids path issues during Vite pre-bundling by using a dynamic approach.
let EE: any;

try {
  // The events polyfill sets module.exports = EventEmitter (a function)
  // When imported as ESM via Vite, it may come as { default: EventEmitter } or just EventEmitter
  // We need to handle all cases robustly.

  // Direct import from the package name (bypassing our own alias via the raw specifier)
  // Vite will resolve this to node_modules/events/events.js during pre-bundling
  const pkg = (globalThis as any).events
    || (globalThis as any).EventEmitter;

  if (typeof pkg === 'function' && pkg.prototype && typeof pkg.prototype.on === 'function') {
    EE = pkg;
  }
} catch (e) {
  // fallback below
}

// If globalThis didn't work, create a minimal polyfill
if (!EE) {
  // Inline minimal EventEmitter for safety
  EE = function EventEmitter(this: any) {
    this._events = Object.create(null);
    this._eventsCount = 0;
    this._maxListeners = undefined;
  };
  EE.prototype.on = function(type: string, listener: Function) {
    if (!this._events[type]) this._events[type] = [];
    this._events[type].push(listener);
    return this;
  };
  EE.prototype.addListener = EE.prototype.on;
  EE.prototype.off = function(type: string, listener: Function) {
    const list = this._events[type];
    if (list) {
      const idx = list.indexOf(listener);
      if (idx !== -1) list.splice(idx, 1);
    }
    return this;
  };
  EE.prototype.removeListener = EE.prototype.off;
  EE.prototype.removeAllListeners = function(type?: string) {
    if (type) delete this._events[type];
    else this._events = Object.create(null);
    return this;
  };
  EE.prototype.emit = function(type: string, ...args: any[]) {
    const list = this._events[type];
    if (!list) return false;
    for (const fn of list.slice()) fn.apply(this, args);
    return true;
  };
  EE.prototype.once = function(type: string, listener: Function) {
    const wrapper = (...args: any[]) => {
      this.off(type, wrapper);
      listener.apply(this, args);
    };
    (wrapper as any).listener = listener;
    this.on(type, wrapper);
    return this;
  };
  EE.prototype.setMaxListeners = function(n: number) {
    this._maxListeners = n;
    return this;
  };
  EE.prototype.getMaxListeners = function() {
    return this._maxListeners !== undefined ? this._maxListeners : 10;
  };
  EE.prototype.listeners = function(type: string) {
    return (this._events[type] || []).slice();
  };
  EE.prototype.listenerCount = function(type: string) {
    return (this._events[type] || []).length;
  };
  EE.prototype.eventNames = function() {
    return Object.keys(this._events);
  };
  EE.EventEmitter = EE;
  EE.defaultMaxListeners = 10;
}

// Ensure the constructor has a reference to itself as .EventEmitter
if (EE && !EE.EventEmitter) {
  EE.EventEmitter = EE;
}

export const EventEmitter = EE;
export default EE;
