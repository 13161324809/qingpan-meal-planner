const fs = require("node:fs"),
  path = require("node:path");
const root = __dirname,
  output = path.join(root, "dist");
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, "data/foods.json"), "utf8"),
);
require("./core.js").mergeFoodPack(
  require("./core.js").initialState(),
  catalog,
);
fs.writeFileSync(
  path.join(root, "data/foods.js"),
  "// Generated from data/foods.json by build.cjs; edit the JSON source.\n" +
    "globalThis.QingpanBuiltinFoods = " +
    JSON.stringify(catalog, null, 2) +
    ";\n",
);
fs.mkdirSync(path.join(output, "vendor"), { recursive: true });
fs.mkdirSync(path.join(output, "data"), { recursive: true });
for (const file of [
  "index.html",
  "styles.css",
  "app.js",
  "core.js",
  "worker.js",
  "data/foods.json",
  "data/foods.js",
  "vendor/solver.js",
  "vendor/LICENSE",
  ".nojekyll",
])
  fs.copyFileSync(path.join(root, file), path.join(output, file));
console.log("Static application copied to dist/");
