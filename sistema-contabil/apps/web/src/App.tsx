import { AppShell } from './components/AppShell.tsx';
import { HomePage } from './pages/HomePage.tsx';

/** Esqueleto da UI: nenhuma tela de produto nesta tarefa (TASK-011+). */
export function App() {
  return (
    <AppShell>
      <HomePage />
    </AppShell>
  );
}
