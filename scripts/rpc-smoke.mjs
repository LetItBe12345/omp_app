import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ompPath = fileURLToPath(new URL("../runtime/omp", import.meta.url));
const fakeMode = process.env.OMP_RPC_FAKE === "1";
const executable = fakeMode ? process.execPath : ompPath;
const args = fakeMode
  ? [fileURLToPath(new URL("../tests/fixtures/fake-omp.mjs", import.meta.url))]
  : ["--mode", "rpc", "--no-session", "--no-extensions", "--no-skills", "--no-rules"];
const requestId = "rpc-smoke-1";
const child = spawn(
  executable,
  args,
  { stdio: ["pipe", "pipe", "pipe"] },
);

let buffer = "";
let sawReady = false;
let sawEvent = false;
let sawResponse = false;

const timer = setTimeout(() => {
  child.kill("SIGTERM");
  throw new Error("OMP RPC smoke test timed out");
}, 20_000);

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);

    if (message.type === "ready") {
      sawReady = true;
      console.log("ready");
      child.stdin.write(`${JSON.stringify({ type: "get_state", id: requestId })}\n`);
    } else if (message.type === "response" && message.id === requestId) {
      sawResponse = message.success === true;
      console.log(`response: ${message.command}, success=${message.success}`);
      child.stdin.end();
    } else {
      sawEvent = true;
      console.log(`event: ${message.type}`);
    }
  }
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

child.on("error", (error) => {
  clearTimeout(timer);
  throw error;
});

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  if (code !== 0 || signal || !sawReady || !sawEvent || !sawResponse) {
    console.error(
      `failed: code=${code}, signal=${signal}, ready=${sawReady}, event=${sawEvent}, response=${sawResponse}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log("OMP RPC smoke test passed");
});
