import { Building2, Sparkles, ShieldAlert } from 'lucide-react';

export default function App() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl w-full panel">
        <header className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-md bg-carbon-200 grid place-items-center ring-1 ring-trim">
            <Building2 className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="font-mono text-lg tracking-wide">GENESIS HQ LAB</h1>
            <p className="text-xs text-zinc-400 font-mono">
              Isolated visual experimentation space
            </p>
          </div>
        </header>

        <section className="space-y-3 text-sm text-zinc-300 leading-relaxed">
          <p>
            This is the lab. The production app lives in <code className="font-mono text-emerald-400">../genesis</code>.
            Nothing here touches it.
          </p>

          <div className="rounded-md border border-trim bg-carbon-200 p-3 text-[13px]">
            <div className="flex items-center gap-2 text-amber-300 mb-1.5">
              <ShieldAlert className="w-4 h-4" />
              <span className="font-mono uppercase text-xs tracking-wider">Before you edit</span>
            </div>
            <ul className="list-disc list-inside text-zinc-400 space-y-1">
              <li>Read <code className="font-mono">AGENTS.md</code></li>
              <li>Read <code className="font-mono">docs/VISION.md</code></li>
              <li>Read <code className="font-mono">docs/DESIGN_DIRECTION.md</code></li>
              <li>Branch first. Never commit to <code className="font-mono">main</code> directly.</li>
              <li>Append your session to <code className="font-mono">docs/CHANGELOG_AI.md</code>.</li>
            </ul>
          </div>

          <div className="rounded-md border border-trim bg-carbon-200 p-3 text-[13px]">
            <div className="flex items-center gap-2 text-violet-300 mb-1.5">
              <Sparkles className="w-4 h-4" />
              <span className="font-mono uppercase text-xs tracking-wider">North star</span>
            </div>
            <p className="text-zinc-300 italic">
              "Within 3 seconds of opening Genesis HQ, the user can tell which
              agents are working, what they are working on, and whether anything
              needs human attention — without reading numbers."
            </p>
          </div>

          <p className="text-zinc-500 text-xs font-mono">
            Status: <span className="text-zinc-300">bootstrap</span> · No
            features yet. Start with <code className="font-mono">docs/AI_HANDOFF.md</code>.
          </p>
        </section>
      </div>
    </main>
  );
}
