// Local app with fixed-path JSON persistence, bound to loopback only.
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const root = __dirname,
  port = Number(process.env.PORT || 4173);
const allowed = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "github-sync.js",
  "local-file.js",
  "core.js",
  "worker.js",
  "solver-client.js",
  "solver-worker-source.js",
  "data/foods.json",
  "data/foods.js",
  "vendor/solver.js",
]);
function createServer({dataFile=process.env.QINGPAN_DATA_FILE || path.join(root,"personal-data","轻盘个人数据.json")}={}) {
  const dataHandler=require('./local-data-server.cjs').localDataHandler(dataFile);
  return http.createServer((req, res) => {
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
    if (p === 'api/local-data') {dataHandler(req,res);return;}
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405).end();return;}
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
    if (p === 'index.html') {
      res.end(fs.readFileSync(path.join(root,p),'utf8').replace('</head>','<script>globalThis.QingpanLocalServer = true;</script></head>'));
    } else fs.createReadStream(path.join(root, p)).pipe(res);
  });
}
module.exports={createServer};
if(require.main===module) {
  require('./build.cjs');
  const url=`http://127.0.0.1:${port}`;
  const openBrowser=()=>{
    if(process.argv.includes('--open') && process.platform==='win32')
      require('node:child_process').spawn('explorer.exe',[url],{windowsHide:true,stdio:'ignore'}).on('error',()=>console.log('Open the URL above in your browser.'));
  };
  createServer().on('error',async error=>{
    if(error.code==='EADDRINUSE') {
      try {
        const response=await fetch(url+'/api/local-data',{signal:AbortSignal.timeout(2000)}), result=await response.json();
        const expected=path.resolve(process.env.QINGPAN_DATA_FILE || path.join(root,'personal-data','轻盘个人数据.json'));
        if(result.path===expected) {console.log(`Already running: ${url}`);openBrowser();return;}
      } catch {}
    }
    console.error(error.message);process.exitCode=1;
  }).listen(port, "127.0.0.1", () => {
    console.log(`Local: ${url}`);
    openBrowser();
  });
}
