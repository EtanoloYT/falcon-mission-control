import { EventEmitter } from "node:events";

const globalState = globalThis as typeof globalThis & { mcBus?: EventEmitter };

export const bus = globalState.mcBus ?? new EventEmitter();

bus.setMaxListeners(100);

if (!globalState.mcBus) {
  globalState.mcBus = bus;
}
