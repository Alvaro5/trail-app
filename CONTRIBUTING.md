# Contributing to GradePace

Thanks for taking a look. GradePace is a small, opinionated project with a real
race behind it, so contributions are welcome but the bar is "does this make the
pacing plan more honest or the app more useful," not "more features."

## Ground rules

- **The engine is the asset.** `src/lib/pacing.ts` is pure TypeScript: no React,
  no DOM, fully unit-tested. Domain logic lives there and stays testable. UI
  glue lives in `src/App.tsx` and the component files.
- **Verify against reality, not vibes.** Distances should match known race
  lengths, D+ should match published figures, and the Minetti cost model must
  match the 2002 paper's measured anchors. There are tests that lock these.
- **Keep the tests green.** `npm test` must pass. A coefficient typo should fail
  loudly, so please add a test when you add behavior.
- **Honest uncertainty over false precision.** The product presents a finish
  *range* on purpose. Changes that pretend to more accuracy than a GPX-only
  prediction can deliver will be pushed back on.

## Getting set up

```sh
npm install
npm run dev      # local dev server
npm run test     # engine + app tests (Vitest)
npm run lint
npm run build    # production build (also what CI runs)
```

## Proposing a change

1. Open an issue first for anything non-trivial, so we can agree on the shape
   before you write code. Bug reports with the GPX file (or a link) and what you
   expected vs. saw are the most useful.
2. Keep pull requests small and focused. One idea per PR.
3. Don't bundle a model/behavior change (anything that moves the projected
   finish time) into an unrelated PR. Call it out so it can be reviewed on its
   own merits.
4. Run `npm run lint && npm test && npm run build` before pushing.

## Where things are

The current technical state, decisions, and roadmap live in
[STATUS.md](./STATUS.md). Read it first. The high-level architecture is in the
[README](./README.md#project-structure).
