// Dependency-free local preview, limited to public application assets.
require("./build.cjs");
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const root = __dirname,
  port = Number(process.env.PORT || 4173);
const allowed = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "core.js",
  "worker.js",
  "solver-client.js",
  "solver-worker-source.js",
  "data/foods.json",
  "data/foods.js",
  "vendor/solver.js",
]);
http
  .createServer((req, res) => {
    let p;
    try {
      p =
        decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        ).replace(/^\/+|\/+$/g, "") || "index.html";
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (!allowed.has(p)) {
      res.writeHead(404).end("Not found");
      return;
    }
    const mime = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
    };
    res.writeHead(200, {
      "Content-Type": mime[path.extname(p)],
      "Cache-Control": "no-store",
    });
    fs.createReadStream(path.join(root, p)).pipe(res);
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`Local: http://127.0.0.1:${port}`),
  );
