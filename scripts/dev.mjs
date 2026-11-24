import { spawn, spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir, onlyTs = false, snapshot = new Map()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, onlyTs, snapshot);
    else if (entry.isFile() && (!onlyTs || path.endsWith(".ts"))) {
      const { mtimeMs, size } = statSync(path);
      snapshot.set(path, `${mtimeMs}:${size}`);
    }
  }
  return snapshot;
}

function changed(before, after) {
  return (
    before.size !== after.size ||
    [...after].some(([path, value]) => before.get(path) !== value)
  );
}

function build() {
  return spawnSync("npm", ["run", "build"], { stdio: "inherit" }).status === 0;
}

if (!build()) process.exit(1);
let source = files("src", true);
let publicFiles = files("public");
let server;
let stopping = false;
let updating = false;

function start() {
  server = spawn(process.execPath, ["dist/src/server.js"], {
    stdio: "inherit",
    env: { ...process.env, LOCAL_DEV_RELOAD: "1" },
  });
}

async function restart() {
  if (server.exitCode === null && server.signalCode === null) {
    const previous = server;
    previous.kill("SIGTERM");
    await new Promise((resolve) => previous.once("exit", resolve));
  }
  if (!stopping) start();
}

start();
const timer = setInterval(async () => {
  if (updating || stopping) return;
  updating = true;
  try {
    const nextSource = files("src", true);
    const nextPublic = files("public");
    const sourceChanged = changed(source, nextSource);
    const publicChanged = changed(publicFiles, nextPublic);
    source = nextSource;
    publicFiles = nextPublic;
    if ((sourceChanged || publicChanged) && (!sourceChanged || build()))
      await restart();
  } catch (error) {
    console.error("Development watcher:", error);
  } finally {
    updating = false;
  }
}, 500);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    clearInterval(timer);
    if (server.exitCode === null && server.signalCode === null)
      server.kill("SIGTERM");
  });
}
