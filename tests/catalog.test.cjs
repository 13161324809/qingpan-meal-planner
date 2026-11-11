const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const C = require("../core.js");
const catalog = JSON.parse(
  fs.readFileSync(require.resolve("../data/foods.json"), "utf8"),
);
test("自带JSON与离线脚本一致，14种营养数据经过校验，缺失值保留未知", () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync(require.resolve("../data/foods.js"), "utf8"),
    ctx,
  );
  assert.equal(
    JSON.stringify(ctx.QingpanBuiltinFoods),
    JSON.stringify(catalog),
  );
  catalog.foods.forEach(C.validateFood);
  assert.equal(catalog.foods.length, 14);
  const missing = catalog.foods.filter((f) =>
    C.keys.some((k) => f[k] === null),
  );
  assert.equal(missing.length, 4);
});
test("首次安装保留现有食物与记录；相同食物只添加一次", () => {
  const state = C.initialState();
  const existing = C.clone(catalog.foods[0]);
  existing.kcal = 400;
  state.foods = [existing];
  const installed = C.installBuiltinFoods(state, catalog);
  assert.equal(installed.state.foods.length, 14);
  assert.equal(installed.state.foods[0].kcal, 400);
  assert.equal(state.foods.length, 1);
  const again = C.installBuiltinFoods(installed.state, catalog);
  assert.equal(again.added, 0);
  assert.equal(again.changed, false);
  assert.deepEqual(installed.state.profiles, state.profiles);
  assert.deepEqual(installed.state.days, state.days);
});
test("删掉自带食物后刷新不复活；新版本只补充从未见过的编号", () => {
  const state = C.installBuiltinFoods(C.initialState(), catalog).state;
  const removed = state.foods.shift();
  state.foods[0].name = "个人修改的名称";
  const again = C.installBuiltinFoods(state, catalog);
  assert.equal(again.state.foods.length, 13);
  assert.equal(again.state.foods[0].name, "个人修改的名称");
  assert.ok(!again.state.foods.some((f) => f.id === removed.id));
  const newCatalog = C.clone(catalog);
  newCatalog.foods.push({
    ...catalog.foods[0],
    id: "catalog-next-version-fixture",
    name: "仅测试的新食物",
  });
  const upgraded = C.installBuiltinFoods(again.state, newCatalog);
  assert.equal(upgraded.added, 1);
  assert.equal(upgraded.state.foods.length, 14);
  assert.ok(!upgraded.state.foods.some((f) => f.id === removed.id));
  assert.equal(upgraded.state.foods[0].name, "个人修改的名称");
});
test("备份包含初始化记录并兼容旧格式；无效元数据被拒绝", () => {
  const state = C.installBuiltinFoods(C.initialState(), catalog).state;
  assert.equal(
    C.validateState(JSON.parse(JSON.stringify(state))).builtinFoodsSeen.length,
    14,
  );
  const legacy = C.initialState();
  delete legacy.builtinFoodsSeen;
  assert.ok(C.validateState(legacy));
  for (const bad of ["bad", [null], ["a", "a"]]) {
    const corrupt = C.clone(state);
    corrupt.builtinFoodsSeen = bad;
    assert.throws(() => C.validateState(corrupt));
  }
});
