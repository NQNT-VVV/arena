'use client';

import { useSyncExternalStore } from 'react';
import { getToasts, getToastsServer, subscribeToasts } from '@/lib/toast';

export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToastsServer);
  if (!toasts.length) return null;
  return (
    <div id="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind} ${t.leaving ? 'out' : ''}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
