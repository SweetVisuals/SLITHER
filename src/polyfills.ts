// src/polyfills.ts
import { Buffer } from 'buffer';
import process from 'process';

if (typeof window !== 'undefined') {
  (window as any).global = window;
  (window as any).globalObject = window;
  (window as any).Buffer = Buffer;
  (window as any).process = process;

  // Process-specific polyfills
  if (!(window as any).process.env) (window as any).process.env = {};
  if (!(window as any).process.nextTick) {
    (window as any).process.nextTick = (cb: any, ...args: any[]) => setTimeout(() => cb(...args), 0);
  }
}

export { Buffer, process };
