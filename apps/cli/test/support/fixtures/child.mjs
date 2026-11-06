// Fixture child for run-child tests. Arguments:
//   exit:N            exit with code N
//   env:KEY           print process.env[KEY]
//   expect-env:K=V    exit 0 if process.env[K] === V, else exit 1
//   kill-self:SIG     send SIG to itself
//   wait              stay alive until a signal arrives
// On SIGTERM it writes "got SIGTERM" and exits 42. When READY_FILE is set it writes "ready"
// there once its handlers are installed.
import { writeFileSync } from "node:fs";

process.on("SIGTERM", () => {
  process.stdout.write("got SIGTERM\n");
  process.exit(42);
});
process.stdout.write("ready\n");
if (process.env.READY_FILE) writeFileSync(process.env.READY_FILE, "ready");

for (const arg of process.argv.slice(2)) {
  const [verb, rest = ""] = arg.split(/:(.*)/s);
  if (verb === "exit") process.exit(Number(rest));
  if (verb === "env") process.stdout.write(`${process.env[rest] ?? ""}\n`);
  if (verb === "expect-env") {
    const [k, v] = rest.split(/=(.*)/s);
    process.exit(process.env[k] === v ? 0 : 1);
  }
  if (verb === "kill-self") process.kill(process.pid, rest);
  if (verb === "wait") setInterval(() => {}, 1000);
}
