import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ompPath = fileURLToPath(new URL("../runtime/omp", import.meta.url));
const fakeMode = process.env.OMP_RPC_FAKE === "1";
const testConfig = !fakeMode && process.env.OMP_RPC_TEST_CONFIG === "1";
const executable = fakeMode ? process.execPath : ompPath;
const args = fakeMode
  ? [fileURLToPath(new URL("../tests/fixtures/fake-omp.mjs", import.meta.url))]
  : ["--mode", "rpc", "--no-session", "--no-extensions", "--no-skills", "--no-rules"];
const requestId = "rpc-smoke-1";
const testDirectory = testConfig ? await mkdtemp(join(tmpdir(), "omp-rpc-smoke-")) : undefined;
if (testDirectory) {
  await mkdir(testDirectory, { recursive: true });
  await writeFile(
    join(testDirectory, "models.yml"),
    "providers:\n  ci-local:\n    baseUrl: http://127.0.0.1:9/v1\n    api: openai-completions\n    auth: none\n    models:\n      - id: ci-smoke\n        name: CI Smoke\n        contextWindow: 4096\n        maxTokens: 256\n",
  );
}
const child = spawn(
  executable,
  args,
  {
    stdio: ["pipe", "pipe", "pipe"],
    env: testDirectory
      ? { ...process.env, PI_CODING_AGENT_DIR: testDirectory, PI_NO_PTY: "1" }
      : process.env,
  },
);

let buffer = "";
let sawReady = false;
let sawEvent = false;
let sawResponse = false;

const timer = setTimeout(() => {
  child.kill("SIGTERM");
  throw new Error("OMP RPC smoke test timed out");
}, 20_000);

async function cleanup() {
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
}

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
  void cleanup().finally(() => {
    throw error;
  });
});

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  void cleanup();
  if (code !== 0 || signal || !sawReady || !sawEvent || !sawResponse) {
    console.error(
      `failed: code=${code}, signal=${signal}, ready=${sawReady}, event=${sawEvent}, response=${sawResponse}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log("OMP RPC smoke test passed");
});
