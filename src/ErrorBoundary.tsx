import { Component, type ReactNode } from "react";

// A render/lifecycle error anywhere in the tree would otherwise unmount
// everything — a silent white screen, the worst outcome for a first-time
// visitor. Class component because error boundaries have no hook equivalent.
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="min-h-screen px-4 py-10">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight">GradePace</h1>
          <div
            role="alert"
            className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 light:text-amber-800"
          >
            Something went wrong rendering the page, sorry. Reloading usually
            fixes it. If it keeps happening, ping{" "}
            <a
              href="https://x.com/AlvaroSerero"
              className="underline hover:text-amber-100"
            >
              @AlvaroSerero
            </a>
            .
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Reload the page
          </button>
        </div>
      </main>
    );
  }
}
