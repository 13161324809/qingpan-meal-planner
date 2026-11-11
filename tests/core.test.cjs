const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const C = require("../core.js");
test("合并食物包保留目标、套餐、每日记录，重复导入不覆盖已编辑数据", () => {
  const state = C.initialState();
  const first = food("a");
  state.foods = [first];
  const pack = {
    type: "qingpan-foods",
    version: 1,
    foods: [food("a", { kcal: 999 }), food("b")],
  };
  const got = C.mergeFoodPack(state, pack);
  assert.equal(got.added, 1);
  assert.equal(got.skipped, 1);
  assert.equal(got.state.foods[0].kcal, 100);
  assert.equal(state.foods.length, 1);
  assert.deepEqual(got.state.profiles, state.profiles);
  assert.deepEqual(got.state.days, state.days);
  assert.deepEqual(got.state.templates, state.templates);
  assert.equal(C.mergeFoodPack(got.state, pack).added, 0);
  const renamedId = food("other-id", { name: first.name });
  assert.equal(
    C.mergeFoodPack(got.state, { ...pack, foods: [renamedId] }).skipped,
    1,
  );
});
test("食物包先整体校验再合并，未知营养保留，坏条目不写入", () => {
  const state = C.initialState();
  const pack = {
    type: "qingpan-foods",
    version: 1,
    foods: [food("a"), food("b", { sodium: null })],
  };
  const got = C.mergeFoodPack(state, pack);
  assert.equal(got.state.foods[1].sodium, null);
  assert.throws(() =>
    C.mergeFoodPack(state, {
      ...pack,
      foods: [food("a"), food("b", { kcal: -1 })],
    }),
  );
  assert.throws(() =>
    C.mergeFoodPack(state, { ...pack, foods: [food("a"), food("a")] }),
  );
  assert.equal(state.foods.length, 0);
});
const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(require.resolve("../vendor/solver.js"), "utf8"),
  ctx,
);
const solver = ctx.solver;
// Synthetic mathematical fixtures, deliberately NOT real food nutrition data.
const food = (id, values = {}) => ({
  id,
  name: "测试-" + id,
  category: "其他",
  brand: "",
  flavor: "",
  kcal: 100,
  protein: 10,
  fat: 2,
  carbs: 10,
  sodium: 50,
  edibleRatio: 1,
  nutritionBasis: "edible",
  weightMode: "测试称重",
  unitGrams: null,
  price: null,
  notes: "仅数学测试数据",
  ...values,
});
const row = (id, f = food(id), over = {}) => ({
  id,
  food: f,
  meal: "午餐",
  min: 0,
  max: 500,
  grams: 0,
  step: 5,
  fixed: false,
  ...over,
});
const target = (over = {}) => ({
  ...C.defaultTarget(),
  kcal: 200,
  protein: 20,
  fat: 4,
  carbs: 20,
  autoCarbs: false,
  energyTolerance: 0,
  fatTolerance: 0,
  carbTolerance: 0,
  sodium: 100,
  ...over,
});
const solve = (rs, t = target(), v = "A") =>
  C.solve(rs, t, ["午餐", "晚餐"], v, solver);
test("kJ 精确使用4.184换算", () =>
  assert.ok(Math.abs(C.kjToKcal(418.4) - 100) < 1e-10));
test("逐项核算每100g的五种营养", () => {
  const s = C.totals([row("1", food("1"), { grams: 125 })]);
  for (const [k, v] of Object.entries({
    kcal: 125,
    protein: 12.5,
    fat: 2.5,
    carbs: 12.5,
    sodium: 62.5,
  }))
    assert.equal(s[k], v);
});
test("可食比例仅对可食口径营养应用一次", () => {
  const f = food("ice", { edibleRatio: 0.8 });
  assert.equal(C.totals([row("1", f, { grams: 250 })]).kcal, 200);
  f.nutritionBasis = "weighed";
  assert.equal(C.totals([row("1", f, { grams: 250 })]).kcal, 250);
});
test("未知营养值保留未知，自动配餐拒绝不完整数据", () => {
  const r = row("a", food("a", { sodium: null }), { grams: 100 });
  assert.ok(C.totals([r]).unknown.includes("sodium"));
  assert.throws(() => solve([r]), /缺少钠/);
});
test("动态求克数，不写死100g，所有营养达标", () => {
  for (const g of [125, 200, 365]) {
    const r = solve(
      [row("a")],
      target({
        kcal: g,
        protein: g / 10,
        fat: g / 50,
        carbs: g / 10,
        sodium: g / 2,
      }),
    );
    assert.equal(r.valid, true);
    assert.equal(r.rows[0].grams, g);
    assert.deepEqual(r.issues, []);
  }
});
test("固定重量保留非步长倍数，其他食物补足；保持餐次", () => {
  const r = solve([
    row("a", food("a"), { grams: 53, fixed: true, meal: "晚餐" }),
    row("b", food("b"), { step: 1 }),
  ]);
  assert.equal(r.valid, true);
  assert.equal(r.rows[0].grams, 53);
  assert.equal(r.rows[1].grams, 147);
  assert.equal(r.rows[0].meal, "晚餐");
});
test("整数步长产生无解时不能假装达标", () => {
  const r = solve(
    [row("a", food("a"), { step: 10 })],
    target({ kcal: 125, protein: 12.5, fat: 2.5, carbs: 12.5, sodium: 100 }),
  );
  assert.equal(r.valid, false);
  assert.ok(r.issues.length);
  assert.equal(r.rows[0].grams % 10, 0);
  assert.ok(r.rows[0].grams !== 125);
});
test("固定重量超过钠上限明确提示，并且不偷偷减重", () => {
  const r = solve([
    row("a", food("a", { sodium: 500 }), { fixed: true, grams: 200 }),
  ]);
  assert.equal(r.rows[0].grams, 200);
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((x) => x.includes("钠超出")));
});
test("最大份量不足明确提示蛋白质与热量不足", () => {
  const r = solve([row("a", food("a"), { max: 100 })]);
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((x) => x.includes("蛋白质不足")));
  assert.ok(r.issues.some((x) => x.includes("热量不足")));
});
test("无效范围、固定重量、步长、餐次及负数拒绝", () => {
  for (const o of [
    { min: 50, max: 10 },
    { fixed: true, grams: 600 },
    { step: 7 },
    { meal: "消失的餐次" },
    { grams: -1 },
    { min: 1, max: 4, step: 5 },
  ])
    assert.throws(() => solve([row("a", food("a"), o)]));
});
test("自动碳水以4/9/4计算，负剩余碳水拒绝", () => {
  assert.equal(C.targetBounds(C.defaultTarget()).carbs.target, 182.5);
  assert.throws(
    () => C.targetBounds(target({ autoCarbs: true, protein: 100 })),
    /超过/,
  );
});
test("方案B控制钠，方案C平衡份量，三方案均满足硬约束", () => {
  const rs = [
    row("a", food("a", { sodium: 0 })),
    row("b", food("b", { sodium: 50 })),
  ];
  const a = solve(rs, target({ sodium: 1000 }), "A"),
    b = solve(rs, target({ sodium: 1000 }), "B"),
    c = solve(rs, target({ sodium: 1000 }), "C");
  for (const r of [a, b, c]) assert.equal(r.valid, true);
  assert.ok(b.totals.sodium <= a.totals.sodium + 1e-6);
  assert.equal(b.rows[1].grams, 0);
  assert.equal(c.rows[0].grams, 100);
  assert.equal(c.rows[1].grams, 100);
});
test("小型整数问题与穷举最优目标函数交叉校验", () => {
  for (const variant of ["A", "B", "C"]) {
    const rs = [
      row("a", food("a", { kcal: 110, sodium: 80 }), { max: 100, step: 10 }),
      row("b", food("b", { kcal: 90, sodium: 20 }), { max: 100, step: 10 }),
    ];
    const t = target({
      kcal: 100,
      protein: 8,
      fat: 2,
      carbs: 10,
      sodium: 100,
      energyTolerance: 15,
      fatTolerance: 1,
      carbTolerance: 3,
    });
    const m = C.buildModel(rs, t, variant);
    m.options.timeout = 10000;
    let best = Infinity;
    for (let a = 0; a <= 100; a += 10)
      for (let b = 0; b <= 100; b += 10) {
        const testRows = C.clone(rs);
        testRows[0].grams = a;
        testRows[1].grams = b;
        if (C.violations(testRows, t).length) continue;
        const s = C.totals(testRows),
          bounds = C.targetBounds(t);
        let cost = 0;
        for (const k of C.keys.filter((k) => k !== "sodium"))
          cost +=
            Math.abs(s[k] - bounds[k].target) * m.variables["under_" + k].cost;
        if (variant === "B") cost += (s.sodium / t.sodium) * 8;
        if (variant === "C")
          cost += (Math.abs(a - 50) * 3) / 100 + (Math.abs(b - 50) * 3) / 100;
        best = Math.min(best, cost);
      }
    const got = solver.Solve(m);
    assert.equal(got.feasible, true);
    assert.ok(
      Math.abs(got.result - best) < 1e-5,
      `${variant}: ${got.result} vs ${best}`,
    );
  }
});
test("备份往返、旧套餐快照不会随食物库编辑改变", () => {
  const s = C.initialState(),
    f = food("a");
  s.foods = [f];
  s.templates = [
    {
      id: "t",
      name: "数学测试",
      meals: ["午餐"],
      target: target(),
      rows: [row("r", C.clone(f), { grams: 200 })],
    },
  ];
  const restored = C.validateState(JSON.parse(JSON.stringify(s)));
  restored.foods[0].kcal = 999;
  assert.equal(restored.templates[0].rows[0].food.kcal, 100);
});
test("损坏与恶意备份拒绝，不把字符串或负数当数据", () => {
  for (const mutate of [
    (s) => (s.version = 99),
    (s) => (s.meals = ["午餐", "午餐"]),
    (s) => (s.foods = [food("x", { protein: -1 })]),
    (s) => (s.foods = [food("x", { protein: "10" })]),
    (s) => (s.activeProfile = "bad"),
    (s) => (s.days = { "2026-01-01": {} }),
  ]) {
    const s = C.initialState();
    mutate(s);
    assert.throws(() => C.validateState(s));
  }
});
test("求解器返回分数或不正确结果时独立核验拦截", () => {
  const bad = { Solve: () => ({ feasible: true, bounded: true, x0: 39.7 }) };
  const r = C.solve([row("a")], target(), ["午餐"], "A", bad);
  assert.equal(r.valid, false);
  assert.equal(r.rows.length, 0);
});
test("冲突诊断给出最大份量不足与固定钠过高的证据", () => {
  const low = solve([row("a", food("a"), { max: 100 })]);
  assert.ok(low.diagnostics.some((x) => x.includes("蛋白质最多10.0")));
  const salt = solve([
    row("a", food("a", { sodium: 500 }), { fixed: true, grams: 200 }),
  ]);
  assert.ok(salt.diagnostics.some((x) => x.includes("钠至少1000.0")));
});
test("多食物不一致营养比例：脂肪、碳水、蛋白质下限均独立验证", () => {
  const rs = [
    row(
      "p",
      food("p", { kcal: 120, protein: 25, fat: 2, carbs: 0, sodium: 0 }),
      { max: 400 },
    ),
    row(
      "c",
      food("c", { kcal: 350, protein: 8, fat: 1, carbs: 76, sodium: 0 }),
      { max: 300 },
    ),
    row(
      "f",
      food("f", { kcal: 900, protein: 0, fat: 100, carbs: 0, sodium: 0 }),
      { max: 50 },
    ),
  ];
  const t = target({
    kcal: 1000,
    protein: 60,
    fat: 25,
    carbs: 100,
    sodium: 100,
    energyTolerance: 10,
    fatTolerance: 5,
    carbTolerance: 10,
  });
  for (const v of ["A", "B", "C"]) {
    const got = solve(rs, t, v);
    assert.equal(got.valid, true);
    assert.ok(got.totals.protein >= 60 - 1e-5);
    assert.ok(got.totals.fat >= 20 - 1e-5 && got.totals.fat <= 30 + 1e-5);
    assert.ok(got.totals.carbs >= 90 - 1e-5 && got.totals.carbs <= 110 + 1e-5);
    for (const r of got.rows) assert.equal(r.grams % 5, 0);
  }
});
