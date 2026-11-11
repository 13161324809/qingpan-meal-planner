const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const { Worker } = require("node:worker_threads");
const Client = require("../solver-client.js"),
  C = require("../core.js");
const sample = { rows: [], target: C.defaultTarget(), meals: ["全天"] };
const ok = (variant) => ({
  variant,
  rows: [{ grams: 100 }],
  valid: true,
  issues: [],
});
test("后台计算按方案报告进度，未限钠时B复用A，不重复启动求解", async () => {
  let created = 0,
    terminated = 0;
  const progress = [];
  const job = Client.createJob(sample, {
    timeoutMs: 100,
    createWorker: () => {
      created++;
      return {
        postMessage(d) {
          setTimeout(
            () => this.onmessage?.({ data: { result: ok(d.variant) } }),
            0,
          );
        },
        terminate() {
          terminated++;
        },
      };
    },
    onProgress: (p) => progress.push(p.variant),
  });
  const out = await job.promise;
  assert.deepEqual(progress, ["A", "B", "C"]);
  assert.equal(created, 2);
  assert.equal(terminated, 2);
  assert.deepEqual(
    out.results.map((r) => r.variant),
    ["A", "B", "C"],
  );
  assert.ok(out.results.every((r) => r.valid));
});
test("无响应任务被外部超时终止，后续方案仍能计算", async () => {
  let terminated = 0;
  const out = await Client.createJob(sample, {
    timeoutMs: 25,
    createWorker: () => ({
      postMessage(d) {
        if (d.variant === "C")
          setTimeout(() => this.onmessage?.({ data: { result: ok("C") } }), 0);
      },
      terminate() {
        terminated++;
      },
    }),
  }).promise;
  assert.equal(out.results[0].valid, false);
  assert.match(out.results[0].issues[0], /超过/);
  assert.equal(out.results[2].valid, true);
  assert.equal(terminated, 2);
});
test("取消后台求解立即终止任务，不继续计算也不返回过时结果", async () => {
  let terminated = 0,
    created = 0;
  const job = Client.createJob(sample, {
    createWorker: () => {
      created++;
      return {
        postMessage() {},
        terminate() {
          terminated++;
        },
      };
    },
  });
  job.cancel();
  await assert.rejects(job.promise, (e) => e.code === "CANCELLED");
  assert.equal(terminated, 1);
  assert.equal(created, 1);
});
test("线程错误和错误消息格式也能结束任务，不永久等待", async () => {
  const out = await Client.createJob(
    { ...sample, target: { ...sample.target, enforceSodium: true } },
    {
      timeoutMs: 100,
      createWorker: () => ({
        postMessage(d) {
          setTimeout(
            () =>
              d.variant === "A"
                ? this.onerror?.(Error("test"))
                : this.onmessage?.({ data: { bad: true } }),
            0,
          );
        },
        terminate() {},
      }),
    },
  ).promise;
  assert.equal(out.results.length, 3);
  assert.ok(out.results.every((r) => !r.valid));
});
test("离线完整worker脚本在真正独立线程处理13种食材，主线程保持响应", async () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync(require.resolve("../solver-worker-source.js"), "utf8"),
    ctx,
  );
  const source = ctx.QingpanSolverWorkerSource;
  assert.ok(!source.includes("importScripts("));
  const foods = JSON.parse(
    fs.readFileSync(require.resolve("../data/foods.json"), "utf8"),
  ).foods.filter((f) =>
    ["kcal", "protein", "fat", "carbs"].every((k) => f[k] !== null),
  );
  const input = {
    ...sample,
    rows: foods.map((food, i) => ({
      id: String(i),
      food,
      meal: "全天",
      grams: 100,
      min: 0,
      max: 500,
      step: 5,
      fixed: false,
    })),
  };
  const bootstrap = `const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;self.postMessage=m=>parentPort.postMessage(m);parentPort.on('message',data=>self.onmessage({data}));(function(module){${source}\n})(undefined);`;
  let beats = 0;
  const heartbeat = setInterval(() => beats++, 10);
  const start = Date.now();
  try {
    const out = await Client.createJob(input, {
      timeoutMs: 4500,
      createWorker: () => {
        const thread = new Worker(bootstrap, { eval: true }),
          bridge = {
            postMessage: (d) => thread.postMessage(d),
            terminate: () => thread.terminate(),
          };
        thread.on("message", (data) => bridge.onmessage?.({ data }));
        thread.on("error", (e) => bridge.onerror?.(e));
        return bridge;
      },
    }).promise;
    assert.ok(
      out.results[0].valid && out.results[2].valid,
      JSON.stringify(out.results.map((r) => r.issues)),
    );
    for (const r of out.results.filter((r) => r.valid))
      assert.deepEqual(C.violations(r.rows, input.target), []);
    assert.ok(beats > 1, "Main thread must continue processing timers");
    assert.ok(
      Date.now() - start < 11000,
      "Independent deadlines must bound the whole job",
    );
  } finally {
    clearInterval(heartbeat);
  }
});
