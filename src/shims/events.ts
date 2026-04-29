// Custom events shim that ensures default and named export compatibility.
// The Particle AA SDK does `import EventEmitter from "events"` (default import)
// but also some internal code does `class X extends events.EventEmitter`.
// This shim handles both patterns by re-exporting EventEmitter correctly.

// Import the actual polyfill from node_modules directly
import * as EventEmitterPkg from '../../node_modules/events/events.js';

// Extract the constructor function
const EE = (EventEmitterPkg as any).EventEmitter || (EventEmitterPkg as any).default || EventEmitterPkg;

// Ensure the constructor has a reference to itself as .EventEmitter
if (EE && !EE.EventEmitter) {
  EE.EventEmitter = EE;
}

export const EventEmitter = EE;
export default EE;
