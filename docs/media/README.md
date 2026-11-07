# docs/media

Screenshots and the CLI recording used by the repository README. They are generated, not drawn: a
fresh local instance is seeded with fake demo data (`apps/web/test/media/seed.ts`), Playwright
captures the dashboard, and [vhs](https://github.com/charmbracelet/vhs) records `cli.tape`. To
regenerate them after a UI change, install vhs once (`brew install vhs`) and run, from the
repository root:

```sh
pnpm --filter ./apps/cli build
pnpm --filter @anchor/web media
```

Each file must stay under 1 MB (the repository test checks it).
