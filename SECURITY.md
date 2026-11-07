# Security policy

Anchor stores other people's secrets. We take reports seriously and are grateful for them.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a vulnerability.**

Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/sotarak/anchor/security/advisories/new)
(Security tab → Advisories → Report a vulnerability). Only the maintainers can see the report.

Please include what you found, how to reproduce it (a minimal proof of concept helps), the affected
component and version or commit, and the impact you expect. Never include real secret values or
tokens from a live instance.

## What to expect

- Acknowledgement within **3 days**.
- An initial assessment (confirmed or not, severity) within **10 days**.
- Updates as we work on a fix, and credit in the advisory and release notes if you want it.

We ask that you give us reasonable time to release a fix before any public disclosure.

## Supported versions

Anchor is pre-1.0. Security fixes land on `main` and in the next release; only the latest release
is supported. Self-hosters should upgrade to it.

## Scope

In scope:

- The server (`apps/server`): authentication, authorization, the API, audit logging.
- The cryptographic design: key hierarchy, envelope encryption, key rotation.
- The dashboard (`apps/web`): XSS, CSRF, session handling, CSP.
- The CLI (`apps/cli`): credential storage, secret handling (argv, output, files).

Out of scope:

- Weaknesses of a deployment's own configuration that the docs already warn about (for example, no
  WAF rate-limiting rule on the auth endpoints, see the operations guide).
- A compromised Cloudflare account or root key: Anchor's model trusts the platform and the root
  key holder (see the [security model](https://sotarak.github.io/anchor/security/model/)).
- Denial of service through volume alone, and findings from automated scanners without a working
  impact.

## Safe harbor

We will not pursue legal action against good-faith research that follows this policy: test only
against your own instance, avoid privacy violations and data destruction, and stop and report as
soon as you find a problem.
