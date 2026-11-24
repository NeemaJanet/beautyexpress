/** Shown instead of the app when the Supabase environment variables are missing. */
export default function SetupNoticePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <h1 className="text-4xl">Almost there</h1>
      <p className="mt-4 text-ink-soft">
        The app cannot find its Supabase settings. Create a file named <code className="rounded bg-sand-soft px-1">.env</code>{' '}
        in the project folder (copy <code className="rounded bg-sand-soft px-1">.env.example</code>) and fill in:
      </p>
      <pre className="mt-4 overflow-x-auto rounded-[var(--radius-panel)] bg-ink p-4 text-sm text-cream">
        {`VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key`}
      </pre>
      <p className="mt-4 text-ink-soft">
        Then stop the dev server (Ctrl + C) and run <code className="rounded bg-sand-soft px-1">npm run dev</code> again. The
        README explains where to find these values.
      </p>
    </main>
  )
}
