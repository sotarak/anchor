# The README's CLI recording. Rendered by apps/web/test/media/media.spec.ts against a seeded local
# instance (ANCHOR_API_URL, a throwaway config dir and file credential store come from there).
# Regenerate: see docs/media/README.md.

Output docs/media/cli.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 640
Set Padding 24
Set Theme "Github"
Set TypingSpeed 45ms

Hide
Type "export PS1='$ ' && clear"
Enter
Show

Type "anchor login"
Sleep 400ms
Enter
Sleep 1s
Type "maya@acme.dev"
Enter
Sleep 600ms
# The demo password is fake (apps/web/test/media/seed.ts); it is typed off-camera anyway.
Hide
Type "demo-password-123"
Show
Enter
Sleep 2s

Type "anchor secrets list --project payments-api --env prod"
Sleep 400ms
Enter
Sleep 2.5s

Type "anchor run --project payments-api --env prod -- node -e 'console.log(`DATABASE_URL set: ${!!process.env.DATABASE_URL}`)'"
Sleep 400ms
Enter
Sleep 3s
