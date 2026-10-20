import type { ReactNode } from 'react';
import { texts } from '../i18n/pt-BR.ts';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <main>
      <h1>{texts.appTitle}</h1>
      {children}
    </main>
  );
}
