const fs = require("node:fs"),
  path = require("node:path");
const root = __dirname,
  output = path.join(root, "dist");
fs.mkdirSync(path.join(output, "vendor"), { recursive: true });
for (const file of [
  "index.html",
  "styles.css",
  "app.js",
  "core.js",
  "worker.js",
  "vendor/solver.js",
  "vendor/LICENSE",
  ".nojekyll",
])
  fs.copyFileSync(path.join(root, file), path.join(output, file));
console.log("Static application copied to dist/");
