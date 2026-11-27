const fs = require("fs");
const path = require("path");

const MAX_BACKUPS_PER_FILE = 20;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function pad3(n) {
  return String(n).padStart(3, "0");
}

function getDateFolder(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function getTimeStamp(d) {
  return `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}-${pad3(d.getMilliseconds())}`;
}

function isSubPath(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function findLatestBackupForRel(backupRoot, relPath) {
  if (!fs.existsSync(backupRoot)) return [];
  const matches = [];
  const baseName = path.basename(relPath);
  const relDir = path.dirname(relPath);
  const prefix = `${baseName}.`;

  let dateDirs = [];
  try {
    dateDirs = fs.readdirSync(backupRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch (_) {
    return [];
  }

  for (const dateDir of dateDirs) {
    const targetDir = path.join(backupRoot, dateDir, relDir);
    if (!fs.existsSync(targetDir)) continue;
    try {
      const files = fs.readdirSync(targetDir)
        .filter((f) => f.startsWith(prefix) && f.endsWith(".bak"))
        .sort();
      for (const f of files) {
        matches.push(path.join(targetDir, f));
      }
    } catch (_) {}
  }

  return matches;
}

function backupTargetFile(payload) {
  const args = (payload && payload.toolCall && payload.toolCall.args) || {};
  const rawTarget = args.Path || args.TargetFile || args.path || "";
  if (!rawTarget || typeof rawTarget !== "string") return;

  const workspaceRoot = path.resolve(
    (Array.isArray(payload.workspacePaths) && payload.workspacePaths[0]) ||
    payload.cwd ||
    path.resolve(__dirname, "..")
  );
  const resolvedTarget = path.resolve(workspaceRoot, rawTarget);

  if (!isSubPath(workspaceRoot, resolvedTarget)) return;
  const relPath = path.relative(workspaceRoot, resolvedTarget);
  const firstSegment = relPath.split(path.sep)[0];
  if (firstSegment === ".backups" || firstSegment === ".git" || firstSegment === "node_modules") return;

  if (!fs.existsSync(resolvedTarget)) return;
  const stat = fs.statSync(resolvedTarget);
  if (!stat.isFile()) return;

  const backupRoot = path.join(workspaceRoot, ".backups");
  const existingBackups = findLatestBackupForRel(backupRoot, relPath);
  const currentBuf = fs.readFileSync(resolvedTarget);

  if (existingBackups.length > 0) {
    const latestPath = existingBackups[existingBackups.length - 1];
    try {
      const latestBuf = fs.readFileSync(latestPath);
      if (currentBuf.equals(latestBuf)) return;
    } catch (_) {}
  }

  const now = new Date();
  const destPath = path.join(
    backupRoot,
    getDateFolder(now),
    `${relPath}.${getTimeStamp(now)}.bak`
  );
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, currentBuf);

  const excessCount = existingBackups.length + 1 - MAX_BACKUPS_PER_FILE;
  for (let i = 0; i < excessCount; i++) {
    try {
      fs.unlinkSync(existingBackups[i]);
    } catch (_) {}
  }
}

let rawInput = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  rawInput += chunk;
});
process.stdin.on("end", () => {
  try {
    const payload = rawInput.trim() ? JSON.parse(rawInput) : {};
    backupTargetFile(payload);
  } catch (err) {
    process.stderr.write(`[auto-backup] ${err && err.message ? err.message : err}\n`);
  }
  process.stdout.write(JSON.stringify({ decision: "allow" }));
});
