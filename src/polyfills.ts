// src/polyfills.ts
import { Buffer } from 'buffer';
import process from 'process';
import EventEmitter from 'events';

if (typeof window !== 'undefined') {
  (window as any).global = window;
  (window as any).globalObject = window;
  (window as any).Buffer = Buffer;
  (window as any).process = process;
  
  // Ensure EventEmitter is globally available and robust
  const EE = (EventEmitter as any).EventEmitter || (EventEmitter as any).default || EventEmitter;
  (window as any).EventEmitter = EE;
  
  // Some libraries expect a global 'events' object
  (window as any).events = { 
    EventEmitter: EE,
    default: EE
  };

  // Process-specific polyfills
  if (!(window as any).process.env) (window as any).process.env = {};
  if (!(window as any).process.nextTick) {
    (window as any).process.nextTick = (cb: any, ...args: any[]) => setTimeout(() => cb(...args), 0);
  }
}

export { Buffer, process, EventEmitter };
