const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const C = require("../core.js");
const catalog = JSON.parse(
  fs.readFileSync(require.resolve("../data/foods.json"), "utf8"),
);

test("香蕉按65%果肉折算为带皮称重，旧快照仍按原口径核算费用，鸡胸肉价格对应正确", () => {
  const update=catalog.foodUpdates.find(u=>u.id==='reference-usda-09040');
  const banana=catalog.foods.find(f=>f.id===update.id);
  const old={...banana,...update.from}; delete old.purchase;
  const state=C.initialState(); state.foods=[old];
  const migrated=C.installBuiltinFoods(state,catalog).state.foods.find(f=>f.id===old.id);
  assert.ok(migrated.name.includes('带皮'));
  assert.ok(Math.abs(migrated.kcal-89*.65)<1e-9);
  assert.ok(Math.abs(C.costs([{food:migrated,grams:1000}]).known-6)<1e-9);
  assert.ok(Math.abs(C.costs([{food:old,grams:650}],[migrated]).known-6)<1e-9);
  assert.equal(old.kcal,89);
  assert.equal(catalog.foods.find(f=>f.id==='photo-20261111-chicken-pinduoduo').purchase.amount,88.8);
  assert.equal(catalog.foods.find(f=>f.id==='photo-20261111-cp-shuanrou').purchase,undefined);
});

test("旧食物库补入采购价，个人价格与主动清空保留，葱姜按名称补价", () => {
  const state=C.installBuiltinFoods(C.initialState(),catalog).state;
  const priced=state.foods.find(f=>f.purchase);
  const id=priced.id;
  delete priced.purchase;
  const installed=C.installBuiltinFoods(state,catalog);
  assert.ok(installed.state.foods.find(f=>f.id===id).purchase);
  assert.equal(installed.changed,true);
  priced.price=999;
  assert.equal(C.installBuiltinFoods(state,catalog).state.foods.find(f=>f.id===id).purchase,undefined);
  priced.price=null; priced.purchase=null;
  assert.equal(C.installBuiltinFoods(state,catalog).state.foods.find(f=>f.id===id).purchase,null);
  const personal={...state.foods[0],id:"personal-spring-onion",name:"葱",price:null};
  delete personal.purchase; state.foods.push(personal);
  assert.equal(C.installBuiltinFoods(state,catalog).state.foods.find(f=>f.id===personal.id).purchase.amount,2);
});

test("用户确认的两个坚果迁移为一条，历史营养快照保持原样", () => {
  const state = C.installBuiltinFoods(C.initialState(), catalog).state;
  const nut = state.foods.find(f => f.id === "photo-20261111-nuts");
  nut.name = "高蛋白纯纯坚果（截图款）";
  state.foods.push({ ...nut, id: "photo-20261112-pure-nut-kernels", name: "纯坚果仁（罐装）" });
  const result = C.installBuiltinFoods(state, catalog);
  assert.equal(result.changed, true);
  assert.equal(result.state.foods.filter(f => /坚果/.test(f.name)).length, 1);
  assert.equal(result.state.foods.find(f => f.id === nut.id).name, "纯坚果仁（罐装）");
  assert.equal(state.foods.length, catalog.foods.length + 1);
  assert.equal(C.installBuiltinFoods(result.state, catalog).changed, false);
});
test("自带JSON与离线脚本一致，营养数据经过校验，缺失值保留未知", () => {
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
  assert.equal(catalog.foods.length, catalog.foods.length);
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
  assert.equal(installed.state.foods.length, catalog.foods.length);
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
  assert.equal(again.state.foods.length, catalog.foods.length - 1);
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
  assert.equal(upgraded.state.foods.length, catalog.foods.length);
  assert.ok(!upgraded.state.foods.some((f) => f.id === removed.id));
  assert.equal(upgraded.state.foods[0].name, "个人修改的名称");
});
test("备份包含初始化记录并兼容旧格式；无效元数据被拒绝", () => {
  const state = C.installBuiltinFoods(C.initialState(), catalog).state;
  assert.equal(
    C.validateState(JSON.parse(JSON.stringify(state))).builtinFoodsSeen.length,
    catalog.foods.length,
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
