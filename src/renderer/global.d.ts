import type { ChronicleApi } from '../shared/contracts';

declare global {
  interface Window {
    chronicle: ChronicleApi;
  }
}

export {};
