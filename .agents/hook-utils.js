const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

function readStdinJson() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(raw.trim() ? JSON.parse(raw) : {});
      } catch (_) {
        resolve({});
      }
    });
  });
}

function getWorkspaceRoot(payload) {
  return path.resolve(
    (payload && Array.isArray(payload.workspacePaths) && payload.workspacePaths[0]) ||
      (payload && payload.cwd) ||
      path.resolve(__dirname, "..")
  );
}

function isSubPath(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function checkFileSyntax(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return null;

  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    try {
      execFileSync(process.execPath, ["--check", filePath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return null;
    } catch (err) {
      return (err.stderr || err.message || "JS syntax error").trim();
    }
  }

  if (ext === ".json") {
    try {
      JSON.parse(fs.readFileSync(filePath, "utf8"));
      return null;
    } catch (err) {
      return `JSON error: ${err.message}`;
    }
  }

  if (ext === ".html" || ext === ".htm") {
    const html = fs.readFileSync(filePath, "utf8");
    const scriptRe = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    let idx = 0;
    while ((m = scriptRe.exec(html)) !== null) {
      idx++;
      const code = m[1].trim();
      if (!code) continue;
      try {
        new vm.Script(code, { filename: `${path.basename(filePath)}#script-${idx}` });
      } catch (err) {
        return `Inline <script> #${idx} error: ${err.message}`;
      }
    }
  }

  return null;
}

const IGNORED_TOP_DIRS = new Set([".backups", ".git", "node_modules", ".vscode"]);
const IGNORED_BASENAMES = new Set(["package-lock.json", "dump_du_lieu.txt"]);
const FORMATTABLE_EXTS = new Set([".js", ".mjs", ".cjs", ".css", ".html", ".htm", ".json", ".md"]);

function isIgnoredRelPath(relPath) {
  if (!relPath) return true;
  const parts = relPath.split(/[\\/]/);
  if (IGNORED_TOP_DIRS.has(parts[0])) return true;
  const base = path.basename(relPath);
  if (IGNORED_BASENAMES.has(base)) return true;
  if (/\.min\.(js|css)$/i.test(base) || /\.log$/i.test(base)) return true;
  return false;
}

function isFormattableFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return FORMATTABLE_EXTS.has(ext);
}

function findPrettierBin(workspaceRoot) {
  const binName = process.platform === "win32" ? "prettier.cmd" : "prettier";
  const localBin = path.join(workspaceRoot, "node_modules", ".bin", binName);
  if (fs.existsSync(localBin)) return localBin;

  try {
    execFileSync(binName, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return binName;
  } catch (_) {
    return null;
  }
}

function formatFileWithPrettier(filePath, workspaceRoot) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return { ok: true, skipped: true, reason: "not-a-file" };
  }
  if (!isFormattableFile(filePath)) {
    return { ok: true, skipped: true, reason: "unsupported-ext" };
  }
  const prettierBin = findPrettierBin(workspaceRoot);
  if (!prettierBin) {
    return { ok: false, skipped: true, reason: "prettier-not-installed" };
  }

  try {
    execFileSync(prettierBin, ["--write", filePath], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32"
    });
    return { ok: true, skipped: false };
  } catch (err) {
    return { ok: false, skipped: false, reason: (err.stderr || err.message || "Prettier failed").trim() };
  }
}

module.exports = {
  readStdinJson,
  getWorkspaceRoot,
  isSubPath,
  checkFileSyntax,
  isIgnoredRelPath,
  isFormattableFile,
  findPrettierBin,
  formatFileWithPrettier
};
