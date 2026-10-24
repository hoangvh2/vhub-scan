// Stand-in for the `claude` binary. Mode comes from FAKE_CLAUDE_MODE; the received args and stdin are written to FAKE_CLAUDE_LOG.
import { appendFileSync } from "node:fs";

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, stdin, cwd: process.cwd() }) + "\n");
  const usage = { input_tokens: 2, cache_creation_input_tokens: 1800, cache_read_input_tokens: 100, output_tokens: 70 };
  switch (process.env.FAKE_CLAUDE_MODE) {
    case "error":
      console.log(JSON.stringify({ is_error: true, subtype: "error_during_execution", result: "overloaded" }));
      break;
    case "garbage":
      console.log("not json at all");
      process.exitCode = 1;
      break;
    case "text-result":
      console.log(JSON.stringify({ is_error: false, result: '{"items":[{"id":"a","s":2}]}', usage, total_cost_usd: 0.001 }));
      break;
    case "slow":
      setTimeout(() => console.log("{}"), 5000);
      break;
    default:
      console.log(JSON.stringify({ is_error: false, structured_output: { items: [{ id: "a", s: 3 }] }, usage, total_cost_usd: 0.0007 }));
  }
});
