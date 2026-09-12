'use client';

import { useSyncExternalStore } from 'react';

import { stamp } from '@/lib/hex';
import { getToasts, getToastsServer, subscribeToasts } from '@/lib/toast';

/** Messages systeme : horodates, empiles en bas a droite, apparition et disparition a 0 ms. */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToastsServer);
  if (!toasts.length) return null;
  return (
    <div id="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind} ${t.leaving ? 'out' : ''}`} role="status">
          <time>{stamp(t.at)}</time>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
