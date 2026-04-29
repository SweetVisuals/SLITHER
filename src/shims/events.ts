// Custom events shim that ensures default export compatibility.
// The @particle-network/aa SDK does `import EventEmitter from "events"` (default import)
// but the standard `events` package only exports EventEmitter as a named export.
// This shim bridges the gap by re-exporting EventEmitter as default.

// Use the actual events package path to avoid circular alias resolution
// @ts-ignore - direct path import for polyfill
import EventEmitterPkg from '../../node_modules/events/events.js';

const EventEmitter = EventEmitterPkg.EventEmitter || EventEmitterPkg;

export { EventEmitter };
export default EventEmitter;
