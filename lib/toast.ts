/**
 * Petit magasin de notifications, hors React : n'importe quel gestionnaire
 * d'evenement peut appeler `toast()` sans passer par un contexte.
 */

export type ToastKind = 'ok' | 'err' | 'info';
export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  leaving?: boolean;
}

let sequence = 0;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function emit() {
  toasts = [...toasts];
  for (const fn of listeners) fn();
}

export function toast(message: string, kind: ToastKind = 'info'): void {
  const item: Toast = { id: ++sequence, message, kind };
  toasts.push(item);
  emit();
  setTimeout(() => {
    const found = toasts.find((t) => t.id === item.id);
    if (found) found.leaving = true;
    emit();
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== item.id);
      emit();
    }, 320);
  }, 3200);
}

export function subscribeToasts(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getToasts(): Toast[] {
  return toasts;
}

const EMPTY: Toast[] = [];
export function getToastsServer(): Toast[] {
  return EMPTY;
}
