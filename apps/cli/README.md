# @anchor-secrets/cli

The command-line client for [Anchor](https://sotarak.github.io/anchor/), a self-hosted secrets and
configuration manager that runs entirely on your own Cloudflare account. Developers use it to log
in, link a directory to a project, manage secrets and run commands with secrets injected. CI uses
it with a scoped service token.

## Install

```sh
npm install -g @anchor-secrets/cli
# or run it without installing
npx @anchor-secrets/cli --help
```

Requires Node.js 22.19 or later. The package installs two commands, `anchor` and
`anchor-secrets`. They are the same program; use `anchor-secrets` when another tool (for example
Solana's Anchor framework) already owns `anchor` on your `PATH`.

Homebrew, an install script, a GitHub Action and standalone binaries are described in the
[CLI guide](https://sotarak.github.io/anchor/guides/cli/).

## Getting started

```sh
anchor login --api-url https://anchor.example.com   # email + hidden password prompt
cd my-app
anchor init                                          # pick a project and default environment
anchor secrets set DATABASE_URL                      # hidden prompt for the value
anchor run -- npm start                              # npm start sees DATABASE_URL
```

Secret values are never accepted as arguments, never printed to a terminal without `--reveal`,
and `anchor run` writes nothing to disk.

## Learn more

- [CLI guide](https://sotarak.github.io/anchor/guides/cli/)
- [Use Anchor in CI](https://sotarak.github.io/anchor/guides/ci/)
- [Documentation](https://sotarak.github.io/anchor/)
- [Source and issues](https://github.com/sotarak/anchor)

Licensed under the [Apache License 2.0](https://github.com/sotarak/anchor/blob/main/LICENSE).
