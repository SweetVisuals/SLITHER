// src/polyfills.ts
import { Buffer } from 'buffer';
import process from 'process';
import EventEmitter from 'events';

if (typeof window !== 'undefined') {
  // Essential Node.js globals
  (window as any).global = window;
  (window as any).Buffer = Buffer;
  (window as any).process = process;
  
  // Ensure EventEmitter is available for packages that check global
  (window as any).EventEmitter = EventEmitter;
  
  // Provide globalThis aliases
  if (!(window as any).globalThis) (window as any).globalThis = window;

  // Process-specific polyfills
  if (!process.env) (process as any).env = {};
  if (!process.nextTick) {
    (process as any).nextTick = (cb: Function, ...args: any[]) => setTimeout(() => cb(...args), 0);
  }
}

export { Buffer, process, EventEmitter };
