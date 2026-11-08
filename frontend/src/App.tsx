// Task 0 spike page: proves Tailwind, bundled IBM Plex fonts and all three scripts render. Replaced in task 2.
export const SAMPLES = [
  { lang: "uz", text: "Yurak shovqini aniqlandi. Oʻzbekiston, gʻoʻza, oʻqituvchi." },
  { lang: "ru", text: "Обнаружен шум в сердце. Митральный клапан, аускультация." },
  { lang: "en", text: "Murmur detected. Mitral point, auscultation." },
];

export default function App() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">MurMur toolchain check</h1>
      <ul className="mt-6 space-y-3">
        {SAMPLES.map((s) => (
          <li key={s.lang} lang={s.lang} className="rounded-xl border border-line bg-surface p-4">
            <span className="font-mono text-sm text-ink-500 tabular-nums">{s.lang}</span>
            <p className="mt-1 text-lg">{s.text}</p>
          </li>
        ))}
      </ul>
      <p className="mt-6 font-mono text-signal tabular-nums">00:07.4 / 00:20.0</p>
    </main>
  );
}
