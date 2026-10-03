import { BrowserRouter, Route, Routes } from 'react-router';

// Placeholder shell. Real screens (map, report flow, admin) arrive in later steps.
function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-bold text-brand-900">CleanSpot</h1>
      <p className="text-slate-700">Illegale Müllablagerungen melden und gemeinsam beseitigen.</p>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
