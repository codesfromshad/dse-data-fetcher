// A small pool of parse workers. Requests go to the least busy worker.
import type { ParseResult } from './parse';
import type { ParseRequest } from '../workers/parse.worker';

type Reply = { id: number; ok: true; result: ParseResult } | { id: number; ok: false; message: string };

interface Slot {
  worker: Worker;
  pending: Map<number, { resolve: (r: ParseResult) => void; reject: (e: Error) => void }>;
}

export class ParserPool {
  private slots: Slot[];
  private nextId = 0;

  constructor(size = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1))) {
    this.slots = Array.from({ length: size }, () => {
      const worker = new Worker(new URL('../workers/parse.worker.ts', import.meta.url), { type: 'module' });
      const slot: Slot = { worker, pending: new Map() };
      worker.onmessage = (event: MessageEvent<Reply>) => {
        const reply = event.data;
        const waiter = slot.pending.get(reply.id);
        if (!waiter) return;
        slot.pending.delete(reply.id);
        if (reply.ok) waiter.resolve(reply.result);
        else waiter.reject(new Error(reply.message));
      };
      worker.onerror = (event) => {
        const error = new Error(`Parser crashed: ${event.message}`);
        for (const waiter of slot.pending.values()) waiter.reject(error);
        slot.pending.clear();
      };
      return slot;
    });
  }

  parse(html: string, symbol: string) {
    const slot = this.slots.reduce((a, b) => (b.pending.size < a.pending.size ? b : a));
    const id = this.nextId++;
    return new Promise<ParseResult>((resolve, reject) => {
      slot.pending.set(id, { resolve, reject });
      slot.worker.postMessage({ id, html, symbol } satisfies ParseRequest);
    });
  }

  dispose() {
    for (const slot of this.slots) {
      slot.worker.terminate();
      for (const waiter of slot.pending.values()) waiter.reject(new Error('Parser stopped'));
    }
  }
}
