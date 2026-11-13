'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { CODE_LENGTH } from '@/lib/format';

/**
 * Saisie d'un code de session.
 *
 * Le champ force les majuscules et retire tout ce qui n'appartient pas a
 * l'alphabet des codes : un code recopie depuis une capture d'ecran arrive
 * souvent avec un espace ou un tiret au milieu.
 */
export function JoinForm({ className = '', inputClassName = '' }: { className?: string; inputClassName?: string }) {
  const router = useRouter();
  const [code, setCode] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = code.trim().toUpperCase();
    if (clean.length !== CODE_LENGTH) return;
    router.push(`/play?code=${encodeURIComponent(clean)}`);
  };

  return (
    <form className={className} onSubmit={submit}>
      <input
        className={`input ${inputClassName}`}
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, CODE_LENGTH))}
        placeholder="CODE"
        aria-label="Code de la session"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
        maxLength={CODE_LENGTH}
      />
      <button className="btn primary block" type="submit" disabled={code.length !== CODE_LENGTH}>
        Rejoindre
      </button>
    </form>
  );
}
