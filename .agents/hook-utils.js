const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

function readStdinJson() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
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

module.exports = {
  readStdinJson,
  getWorkspaceRoot,
  isSubPath,
  checkFileSyntax
};
