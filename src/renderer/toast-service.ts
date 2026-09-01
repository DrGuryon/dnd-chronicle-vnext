import { escapeHtml } from './html';

export type ToastType = 'success' | 'info' | 'warning' | 'error';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  count: number;
  timeout: number;
}

export class ToastService {
  private readonly items: ToastItem[] = [];
  private nextId = 1;

  constructor(private readonly host: HTMLElement) {}

  show(message: string, type: ToastType = 'info'): void {
    const normalized = message.trim();
    if (!normalized) return;
    const duplicate = this.items.find((item) => item.message === normalized && item.type === type);
    if (duplicate) {
      duplicate.count += 1;
      window.clearTimeout(duplicate.timeout);
      duplicate.timeout = window.setTimeout(() => this.remove(duplicate.id), 5_000);
      this.render();
      return;
    }
    while (this.items.length >= 4) this.remove(this.items[0]!.id, false);
    const item: ToastItem = {
      id: this.nextId++, message: normalized, type, count: 1,
      timeout: window.setTimeout(() => this.remove(item.id), 5_000),
    };
    this.items.push(item);
    this.render();
  }

  private remove(id: number, render = true): void {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return;
    window.clearTimeout(this.items[index]!.timeout);
    this.items.splice(index, 1);
    if (render) this.render();
  }

  private render(): void {
    this.host.innerHTML = this.items.map((item) => `<div class="app-toast is-${item.type}"
      role="${item.type === 'error' ? 'alert' : 'status'}" aria-live="${item.type === 'error' ? 'assertive' : 'polite'}">
      <span>${escapeHtml(item.message)}</span>${item.count > 1 ? `<strong aria-label="Opakováno ${item.count}krát">×${item.count}</strong>` : ''}
      <button type="button" data-toast-dismiss="${item.id}" aria-label="Zavřít oznámení">×</button></div>`).join('');
    this.host.querySelectorAll<HTMLButtonElement>('[data-toast-dismiss]').forEach((button) => {
      button.addEventListener('click', () => this.remove(Number(button.dataset.toastDismiss)), { once: true });
    });
  }
}
