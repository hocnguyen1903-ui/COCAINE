const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");

const BACKEND_DIR = "./backend";
let timer = null, running = false, pending = false;

function getBackendFiles(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getBackendFiles(fullPath));
    } else if (/\.(js|gs|json|html)$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function computeBackendHash() {
  const hash = crypto.createHash("sha256");
  for (const filePath of getBackendFiles(BACKEND_DIR)) {
    hash.update(filePath + "\0");
    hash.update(fs.readFileSync(filePath));
  }
  return hash.digest("hex");
}

let lastHash = computeBackendHash();

function deploy() {
  if (running) { pending = true; return; }
  const currentHash = computeBackendHash();
  if (currentHash === lastHash) {
    console.log("⏭️ Nội dung không đổi — không push lên GAS.");
    return;
  }

  running = true;
  const prevHash = lastHash;
  lastHash = currentHash;
  console.log("\n⏳ Phát hiện thay đổi — đang push & deploy lên GAS...");

  exec("node gdp.js", (err, stdout, stderr) => {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    if (err) {
      lastHash = prevHash;
      console.log("❌ Lỗi deploy");
    } else {
      console.log("✅ GAS đã cập nhật — bấm Reload (↻) ô Preview!");
    }
    running = false;
    if (pending) { pending = false; deploy(); }
  });
}

fs.watch(BACKEND_DIR, { recursive: true }, (_, file) => {
  if (!file || !/\.(js|gs|json|html)$/i.test(file)) return;
  clearTimeout(timer);
  timer = setTimeout(deploy, 500);
});

console.log("👀 Đang theo dõi thư mục ./backend (chỉ push khi nội dung thực sự thay đổi)...");