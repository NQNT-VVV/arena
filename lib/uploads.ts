'use client';

/**
 * Televersement avec avancement.
 *
 * `fetch` ne publie pas la progression de l'envoi — seulement celle de la
 * reponse. Pour une barre qui avance pendant qu'un rush de deux cents
 * mega-octets monte, il faut encore passer par XMLHttpRequest.
 */

export interface UploadResult<T> {
  ok: boolean;
  status: number;
  body: T | { error: string };
}

export interface UploadHandle<T> {
  promise: Promise<UploadResult<T>>;
  /** Interrompt l'envoi ; la promesse se resout en echec. */
  cancel: () => void;
}

export function uploadFiles<T>(
  url: string,
  files: File[],
  { token, onProgress }: { token?: string | null; onProgress?: (ratio: number) => void } = {},
): UploadHandle<T> {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<UploadResult<T>>((resolve) => {
    const form = new FormData();
    for (const file of files) form.append('files', file, file.name);

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    });

    xhr.addEventListener('load', () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = { error: 'Reponse illisible du serveur.' };
      }
      onProgress?.(1);
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body: body as T });
    });

    xhr.addEventListener('error', () => resolve({
      ok: false, status: 0, body: { error: 'Connexion interrompue pendant l’envoi.' },
    }));
    xhr.addEventListener('abort', () => resolve({
      ok: false, status: 0, body: { error: 'Envoi annule.' },
    }));

    xhr.open('POST', url);
    if (token) xhr.setRequestHeader('X-Arena-Token', token);
    xhr.send(form);
  });

  return { promise, cancel: () => xhr.abort() };
}
