// Optional DOM integration tests: npm install --ignore-scripts, then npm run test:ui.
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
let JSDOM;
try {
  ({ JSDOM } = require(process.env.QINGPAN_JSDOM || "jsdom"));
} catch {}
const builtinCount = JSON.parse(
  fs.readFileSync(require.resolve("../data/foods.json"), "utf8"),
).foods.length;
const C = require("../core.js"),
  root = path.resolve(__dirname, "..");
const options = { skip: !JSDOM };
const tick = () => new Promise((r) => setTimeout(r, 10));
function setup(initial, withBuiltin = false, cloud = null, clock = null, file = null) {
  const dom = new JSDOM(
      fs.readFileSync(path.join(root, "index.html"), "utf8"),
      { url: "http://localhost/", runScripts: "outside-only" },
    ),
    w = dom.window;
  if (clock) {
    const NativeDate = w.Date;
    w.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [clock.now])); }
      static now() { return clock.now; }
    };
  }
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  w.confirm = () => true;
  w.prompt = () => null;
  w.Worker = class {
    postMessage(data) {
      this.timer = w.setTimeout(() => {
        if (this.stopped) return;
        try {
          const result = w.MealCore.solve(
            data.rows,
            data.target,
            data.meals,
            data.variant,
            w.solver,
          );
          this.onmessage?.({ data: { result } });
        } catch (e) {
          this.onmessage?.({ data: { error: e.message } });
        }
      }, 0);
    }
    terminate() {
      this.stopped = true;
      w.clearTimeout(this.timer);
    }
  };
  const downloads = [];
  w.Blob = class {
    constructor(parts) {
      this.content = parts.join("");
    }
  };
  w.URL.createObjectURL = (b) => {
    downloads.push(b.content);
    return "blob:test";
  };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {};
  if (initial !== undefined)
    w.localStorage.setItem(
      "qingpan.v1",
      typeof initial === "string" ? initial : JSON.stringify(initial),
    );
  if (cloud) {
    w.localStorage.setItem("qingpan.githubConfig",JSON.stringify(cloud.config));
    w.sessionStorage.setItem("qingpan.githubToken",cloud.token);
    w.fetch = cloud.fetch;
  }
  if (file) {
    if(file.server) {w.QingpanLocalServer=true;w.fetch=file.fetch;}
    if (file.mode) w.localStorage.setItem("qingpan.fileMode","1");
    w.showSaveFilePicker = file.save;
    w.showOpenFilePicker = file.open;
  }
  for (const f of [
    "vendor/solver.js",
    "core.js",
    "solver-client.js",
    "github-sync.js",
    "local-file.js",
    ...(withBuiltin ? ["data/foods.js"] : []),
    "app.js",
  ])
    w.eval(fs.readFileSync(path.join(root, f), "utf8"));
  return {
    w,
    dom,
    downloads,
    $: (s) => w.document.querySelector(s),
    all: (s) => [...w.document.querySelectorAll(s)],
    state: () => JSON.parse(w.localStorage.getItem("qingpan.v1")),
    close: () => w.close(),
  };
}
function click(t, s) {
  assert.ok(t.$(s), `Missing element ${s}`);
  t.$(s).click();
}
function submit(t, s) {
  t.$(s).dispatchEvent(
    new t.w.Event("submit", { bubbles: true, cancelable: true }),
  );
}
function change(t, el, value) {
  if (typeof el === "string") el = t.$(el);
  if (el.type === "checkbox") el.checked = value;
  else el.value = value;
  el.dispatchEvent(new t.w.Event("change", { bubbles: true }));
}
async function route(t, s) {
  t.w.location.hash = s;
  await tick();
}
function fixture() {
  const s = C.initialState(),
    f = {
      id: "f",
      name: "数学测试食物",
      category: "其他",
      brand: "",
      flavor: "",
      kcal: 100,
      protein: 10,
      fat: 2,
      carbs: 10,
      sodium: 50,
      weightMode: "测试重量",
      edibleRatio: 1,
      nutritionBasis: "edible",
      unitGrams: 50,
      price: null,
      notes: "",
    };
  s.foods = [f];
  s.profiles[0] = {
    ...s.profiles[0],
    kcal: 200,
    protein: 20,
    fat: 4,
    carbs: 20,
    autoCarbs: false,
    sodium: 100,
    energyTolerance: 0,
    fatTolerance: 0,
    carbTolerance: 0,
  };
  return s;
}
test("DOM：食品新增、kJ换算、搜索、编辑、删除与转义", options, async () => {
  const t = setup();
  try {
    click(t, '[data-action="new-food"]');
    const form = t.$("#food-form");
    assert.equal(form.elements.ediblePercent, undefined);
    assert.equal(form.elements.nutritionBasis, undefined);
    for (const [k, v] of Object.entries({
      name: "<img src=x onerror=alert(1)>",
      energyUnit: "kj",
      energy: "418.4",
      protein: "10",
      fat: "2",
      carbs: "10",
      sodium: "50",
      weightMode: "测试净重",
    }))
      form.elements[k].value = v;
    submit(t, "#food-form");
    assert.equal(t.state().foods.length, 1);
    assert.ok(Math.abs(t.state().foods[0].kcal - 100) < 1e-8);
    assert.equal(t.all(".food-picker img").length, 0);
    await route(t, "foods");
    assert.equal(t.all("tbody tr").length, 1);
    const input = t.$("#search");
    input.value = "不存在";
    input.dispatchEvent(new t.w.Event("input", { bubbles: true }));
    assert.equal(t.all("tbody tr").length, 0);
    input.value = "";
    input.dispatchEvent(new t.w.Event("input", { bubbles: true }));
    click(t, '[data-action="edit-food"]');
    form.elements.name.value = "更名后的测试食物";
    submit(t, "#food-form");
    assert.equal(t.state().foods[0].name, "更名后的测试食物");
    click(t, '[data-action="delete-food"]');
    assert.equal(t.state().foods.length, 0);
  } finally {
    t.close();
  }
});
test(
  "DOM：自动求解三方案、保存修改复制套餐、实际独立、备份往返",
  options,
  async () => {
    const t = setup(fixture());
    try {
      click(t, '[data-action="add-food"]');
      click(t, "#solve");
      for (let i = 0; i < 100 && !t.$('[data-action="variant"]'); i++)
        await tick();
      assert.equal(t.all('[data-action="variant"]').length, 3);
      const d = Object.values(t.state().days)[0];
      assert.equal(d.plan[0].grams, 200);
      click(t, '[data-action="save-template"]');
      t.$("#name-form").elements.name.value = "测试套餐";
      submit(t, "#name-form");
      assert.equal(t.state().templates.length, 1);
      click(t, '[data-action="copy-actual"]');
      change(t, 'input[data-field="grams"]', 150);
      assert.equal(Object.values(t.state().days)[0].actual[0].grams, 200);
      await route(t, "templates");
      click(t, '[data-action="duplicate-template"]');
      assert.equal(t.state().templates.length, 2);
      click(t, '[data-action="edit-template"]');
      await tick();
      assert.equal(t.$('input[data-field="grams"]').value, "200");
      change(t, 'input[data-field="grams"]', 175);
      click(t, '[data-action="update-template"]');
      assert.equal(t.state().templates[0].rows[0].grams, 175);
      await route(t, "records");
      assert.equal(t.$('input[data-field="grams"]').value, "200");
      change(t, 'input[data-field="grams"]', 180);
      assert.equal(Object.values(t.state().days)[0].plan[0].grams, 175);
      click(t, "#backup-top");
      const saved = t.downloads.at(-1);
      assert.ok(C.validateState(JSON.parse(saved)));
      await route(t, "settings");
      const next = C.initialState();
      const file = { size: 100, text: async () => JSON.stringify(next) };
      Object.defineProperty(t.$("#import-file"), "files", {
        value: [file],
        configurable: true,
      });
      t.$("#import-file").dispatchEvent(new t.w.Event("change"));
      await tick();
      assert.equal(t.state().foods.length, 0);
      Object.defineProperty(t.$("#import-file"), "files", {
        value: [{ size: saved.length, text: async () => saved }],
        configurable: true,
      });
      t.$("#import-file").dispatchEvent(new t.w.Event("change"));
      await tick();
      assert.equal(t.state().templates.length, 2);
      assert.equal(Object.values(t.state().days)[0].actual[0].grams, 180);
    } finally {
      t.close();
    }
  },
);
test("DOM：目标与多餐设置可编辑，并且跨刷新保留", options, async () => {
  const t = setup(fixture());
  try {
    click(t, '[data-action="add-food"]');
    await route(t, "settings");
    const f = t.$("#target-form");
    f.elements.kcal.value = "300";
    f.elements.protein.value = "30";
    f.elements.autoCarbs.checked = true;
    f.elements.fat.value = "4";
    f.elements.fat.dispatchEvent(new t.w.Event("input", { bubbles: true }));
    assert.equal(f.elements.carbs.value, "36");
    submit(t, "#target-form");
    assert.equal(Object.values(t.state().days)[0].target.kcal, 300);
    t.$("#meals-form").elements.meals.value = "第一餐\n第二餐";
    submit(t, "#meals-form");
    assert.deepEqual(Object.values(t.state().days)[0].meals, [
      "第一餐",
      "第二餐",
    ]);
    const copy = setup(t.state());
    try {
      assert.equal(Object.values(copy.state().days)[0].plan[0].meal, "第一餐");
      assert.equal(Object.values(copy.state().days)[0].target.kcal, 300);
    } finally {
      copy.close();
    }
  } finally {
    t.close();
  }
});
test("DOM：应用不同餐次的套餐不隐藏已存在的实际记录", options, async () => {
  const s = fixture(),
    now = new Date(),
    date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    r = {
      id: "r",
      food: s.foods[0],
      meal: "旧餐次",
      grams: 200,
      min: 0,
      max: 500,
      step: 5,
      fixed: false,
    };
  s.days[date] = {
    meals: ["旧餐次"],
    target: s.profiles[0],
    plan: [],
    actual: [r],
  };
  s.templates = [
    {
      id: "t",
      name: "新餐次套餐",
      meals: ["新餐次"],
      target: s.profiles[0],
      rows: [{ ...r, id: "new", meal: "新餐次" }],
    },
  ];
  const t = setup(s);
  try {
    await route(t, "templates");
    click(t, '[data-action="apply-template"]');
    await route(t, "records");
    assert.equal(Object.values(t.state().days)[0].actual[0].meal, "旧餐次");
    assert.ok(C.validateState(t.state()));
  } finally {
    t.close();
  }
});
test(
  "DOM：仅食物合并导入不清空记录，可重复导入并导出食物包",
  options,
  async () => {
    const t = setup(fixture());
    try {
      click(t, '[data-action="add-food"]');
      click(t, '[data-action="copy-actual"]');
      const before = t.state();
      await route(t, "foods");
      const f = {
        ...before.foods[0],
        id: "new-food",
        name: "第二种测试食物",
        sodium: null,
        notes: "来源 <script>test</script>",
      };
      const pack = {
        type: "qingpan-foods",
        version: 1,
        foods: [before.foods[0], f],
      };
      const input = t.$("#import-file");
      Object.defineProperty(input, "files", {
        value: [{ size: 100, text: async () => JSON.stringify(pack) }],
      });
      input.dispatchEvent(new t.w.Event("change"));
      await tick();
      assert.equal(t.state().foods.length, 2);
      assert.deepEqual(t.state().days, before.days);
      assert.deepEqual(t.state().profiles, before.profiles);
      assert.equal(
        t.$(".food-notes").textContent,
        "来源 <script>test</script>",
      );
      assert.equal(t.all(".food-notes script").length, 0);
      input.dispatchEvent(new t.w.Event("change"));
      await tick();
      assert.equal(t.state().foods.length, 2);
      click(t, '[data-action="export-foods"]');
      const exported = JSON.parse(t.downloads.at(-1));
      assert.equal(exported.type, "qingpan-foods");
      assert.equal(exported.foods[1].sodium, null);
      assert.equal("days" in exported, false);
    } finally {
      t.close();
    }
  },
);
test(
  "DOM：缺钠默认可配餐，严格开关保存后才要求补齐，汇总不冒充已达标钠",
  options,
  async () => {
    const s = fixture();
    s.foods[0].sodium = null;
    const t = setup(s);
    try {
      click(t, '[data-action="add-food"]');
      click(t, "#solve");
      for (let i = 0; i < 100 && !t.$('[data-action="variant"]'); i++)
        await tick();
      assert.equal(t.all('[data-action="variant"]').length, 3);
      assert.equal(t.$('input[data-field="grams"]').value, "200");
      assert.match(t.$(".stats").textContent, /钠（仅记录）.*数据不完整/);
      assert.match(
        t.$("#app").textContent,
        /热量、蛋白质、脂肪和碳水约束已满足/,
      );
      assert.match(t.$("#app").textContent, /钠未启用 · 与A相同/);
      await route(t, "settings");
      assert.equal(t.$('[name="enforceSodium"]').checked, false);
      assert.equal(t.$('[name="sodium"]').disabled, true);
      click(t, '[name="enforceSodium"]');
      assert.equal(t.$('[name="sodium"]').disabled, false);
      submit(t, "#target-form");
      assert.equal(Object.values(t.state().days)[0].target.enforceSodium, true);
      await route(t, "today");
      click(t, "#solve");
      await tick();
      assert.match(t.$("#toast").textContent, /缺少钠/);
      await route(t, "settings");
      click(t, '[name="enforceSodium"]');
      submit(t, "#target-form");
      await route(t, "today");
      click(t, "#solve");
      for (let i = 0; i < 100 && !t.$('[data-action="variant"]'); i++)
        await tick();
      assert.equal(t.all('[data-action="variant"]').length, 3);
    } finally {
      t.close();
    }
  },
);
test("DOM：选食材填热量即可求解，不显示餐次选择", options, async () => {
  const t = setup(fixture());
  try {
    click(t, '[data-action="add-food"]');
    assert.equal(t.all('select[data-field="meal"]').length, 0);
    t.$("#quick-kcal").value = "300";
    click(t, "#solve");
    for (let i = 0; i < 100 && !t.$('[data-action="variant"]'); i++)
      await tick();
    const d = Object.values(t.state().days)[0];
    assert.equal(d.target.kcal, 300);
    assert.equal(d.target.protein, 30);
    assert.equal(d.target.fat, 6);
    assert.equal(d.plan[0].grams, 300);
  } finally {
    t.close();
  }
});
test("DOM：取消按钮恢复可点击状态并保留原计划", options, async () => {
  const t = setup(fixture());
  let terminated = 0;
  try {
    t.w.Worker = class {
      postMessage() {}
      terminate() {
        terminated++;
      }
    };
    click(t, '[data-action="add-food"]');
    const before = t.state();
    click(t, "#solve");
    assert.equal(t.$("#solve").disabled, true);
    click(t, '[data-action="cancel-solve"]');
    await tick();
    assert.equal(t.$("#solve").disabled, false);
    assert.equal(t.$('[data-action="cancel-solve"]'), null);
    assert.deepEqual(t.state().days, before.days);
    assert.equal(terminated, 1);
    assert.match(t.$("#toast").textContent, /已取消/);
  } finally {
    t.close();
  }
});
test("DOM：损坏本地数据不被覆盖，恶意备份不替换有效数据", options, async () => {
  const bad = setup("{broken");
  try {
    click(bad, '[data-action="new-food"]');
    const f = bad.$("#food-form");
    f.elements.name.value = "恢复前测试";
    f.elements.weightMode.value = "净重";
    submit(bad, "#food-form");
    assert.equal(bad.w.localStorage.getItem("qingpan.v1"), "{broken");
    assert.ok(bad.$(".notice.error"));
  } finally {
    bad.close();
  }
  const t = setup(fixture());
  try {
    const original = t.w.localStorage.getItem("qingpan.v1");
    Object.defineProperty(t.$("#import-file"), "files", {
      value: [{ size: 100, text: async () => '{"version":99}' }],
    });
    t.$("#import-file").dispatchEvent(new t.w.Event("change"));
    await tick();
    assert.equal(t.w.localStorage.getItem("qingpan.v1"), original);
    assert.match(t.$("#toast").textContent, /导入失败/);
  } finally {
    t.close();
  }
});
test(
  "DOM：新浏览器自动带入食物，编辑删除刷新保留，恢复自带食物不覆盖编辑",
  options,
  async () => {
    const t = setup(undefined, true);
    try {
      assert.equal(t.state().foods.length, builtinCount);
      assert.equal(t.state().builtinFoodsSeen.length, builtinCount);
      await route(t, "foods");
      click(t, '[data-action="edit-food"]');
      t.$("#food-form").elements.name.value = "我修改过的挂面";
      t.$("#food-form").elements.energy.value = "360";
      submit(t, "#food-form");
      const deleteButtons = t.all('[data-action="delete-food"]');
      deleteButtons[1].click();
      const after = t.state();
      assert.equal(after.foods.length, builtinCount - 1);
      const refreshed = setup(after, true);
      try {
        assert.equal(refreshed.state().foods.length, builtinCount - 1);
        assert.equal(refreshed.state().foods[0].name, "我修改过的挂面");
        assert.equal(refreshed.state().foods[0].kcal, 360);
        await route(refreshed, "foods");
        click(refreshed, '[data-action="restore-builtin"]');
        assert.equal(refreshed.state().foods.length, builtinCount);
        assert.equal(refreshed.state().foods[0].kcal, 360);
        click(refreshed, '[data-action="restore-builtin"]');
        assert.equal(refreshed.state().foods.length, builtinCount);
      } finally {
        refreshed.close();
      }
    } finally {
      t.close();
    }
  },
);
test(
  "DOM：完整恢复保留备份的空食物库，刷新不偷偷加回默认食物",
  options,
  async () => {
    const t = setup(undefined, true);
    try {
      const backup = C.initialState();
      Object.defineProperty(t.$("#import-file"), "files", {
        value: [{ size: 100, text: async () => JSON.stringify(backup) }],
      });
      t.$("#import-file").dispatchEvent(new t.w.Event("change"));
      await tick();
      assert.equal(t.state().foods.length, 0);
      const refreshed = setup(t.state(), true);
      try {
        assert.equal(refreshed.state().foods.length, 0);
      } finally {
        refreshed.close();
      }
    } finally {
      t.close();
    }
  },
);

// Simulate reopening an existing browser after pulling an expanded catalog.
test("DOM：旧食物库刷新补入新增调料，支持分类筛选与编辑保留分类", options, async () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, "data/foods.json"), "utf8"));
  const old = C.installBuiltinFoods(C.initialState(), { ...catalog, foods: catalog.foods.slice(0, 19) }).state;
  const t = setup(old, true);
  try {
    await route(t, "foods");
    assert.equal(t.state().foods.length, catalog.foods.length);
    for (const name of ["葱姜料酒", "生抽（照片款）", "上等蚝油", "蒸鱼豉油（照片款）"])
      assert.ok(t.$("#food-table").textContent.includes(name));
    click(t, '[data-action="filter"][data-value="调味品"]');
    const condiments = t.state().foods.filter((f) => f.category === "调味品");
    assert.equal(t.all("tbody tr").length, condiments.length);
    assert.ok(t.$("#food-table").textContent.includes("蒸鱼豉油（照片款）"));
    click(t, '[data-action="edit-food"][data-id="photo-20261112-haitian-light-soy-sauce"]');
    assert.equal(t.$("#food-form").elements.category.value, "调味品");
    submit(t, "#food-form");
    assert.equal(t.state().foods.find(f => f.id === "photo-20261112-haitian-light-soy-sauce").category, "调味品");
  } finally { t.close(); }
});

test("DOM：鸡蛋按个增减，实际记录独立，条码重复新增被阻止", options, async () => {
  const t = setup(undefined, true);
  try {
    click(t, '[data-action="add-food"][data-id="reference-usda-01123"]');
    const getEgg = () => Object.values(t.state().days)[0].plan.find(r => r.food.id === "reference-usda-01123");
    assert.equal(getEgg().grams, 50);
    click(t, '[data-action="count-plus"]');
    assert.equal(getEgg().grams, 100);
    click(t, '[data-action="count-minus"]');
    assert.equal(getEgg().grams, 50);
    change(t, '[data-field="count"]', '7');
    assert.equal(getEgg().grams, 350);
    click(t, '[data-action="copy-actual"]');
    await route(t, "records");
    click(t, '[data-action="count-minus"][data-actual="true"]');
    assert.equal(Object.values(t.state().days)[0].actual[0].grams, 300);
    assert.equal(getEgg().grams, 350);
    await route(t, "foods");
    click(t, '[data-action="edit-food"][data-id="reference-usda-01123"]');
    t.$("#food-form").elements.barcode.value = "0123456789012";
    submit(t, "#food-form");
    assert.equal(t.state().foods.find(f=>f.id==="reference-usda-01123").barcode, "0123456789012");
    const count = t.state().foods.length;
    click(t, '[data-action="new-food"]');
    const form=t.$("#food-form");
    for(const [k,v] of Object.entries({name:"重复商品",barcode:"0123456789012",energy:"100",protein:"10",fat:"2",carbs:"10",sodium:"0",weightMode:"净重"}))form.elements[k].value=v;
    submit(t, "#food-form");
    assert.equal(t.state().foods.length, count);
    assert.match(t.$("#toast").textContent, /条码已有/);
  } finally { t.close(); }
});

test("DOM：配方保存为整体套餐、整数份增减、编辑与备份保留配方", options, async () => {
  const t=setup(fixture());
  try {
    click(t, '[data-action="new-combo"]');
    t.$('#combo-form').elements.name.value='吃鱼料汁';
    t.$('.combo-ingredient input').value='20';
    click(t, '[data-action="combo-add"]');
    t.all('.combo-ingredient input')[1].value='30';
    submit(t,'#combo-form');
    const combo=t.state().foods.find(f=>f.name==='吃鱼料汁');
    assert.ok(combo.isComposite);
    assert.equal(combo.unitGrams,50);
    assert.equal(combo.ingredients.length,2);
    click(t, '[data-action="add-food"][data-id="'+combo.id+'"]');
    const plan=()=>Object.values(t.state().days)[0].plan;
    assert.equal(plan().length,1);
    assert.equal(plan()[0].fixed,true);
    assert.equal(plan()[0].grams,50);
    assert.ok(t.$('#app').textContent.includes('不拆分原料'));
    change(t,'[data-field="count"]','0.5');
    assert.equal(plan()[0].grams,50);
    assert.match(t.$('#toast').textContent,/整数/);
    click(t,'[data-action="count-plus"]');
    assert.equal(plan()[0].grams,100);
    await route(t,'foods');
    click(t,'[data-action="edit-food"][data-id="'+combo.id+'"]');
    t.all('.combo-ingredient input')[0].value='40';
    submit(t,'#combo-form');
    assert.equal(t.state().foods.find(f=>f.id===combo.id).unitGrams,70);
    assert.equal(plan()[0].food.unitGrams,50);
    const restored=setup(t.state());
    try { assert.equal(restored.state().foods.find(f=>f.id===combo.id).ingredients.length,2); }
    finally { restored.close(); }
  } finally {t.close();}
});

test("DOM：已保存的套餐可直接转换为整体，转换不改动原套餐", options, async () => {
  const state=fixture();
  state.templates=[{id:'sauce-template',name:'吃鱼料汁',meals:['全天'],target:state.profiles[0],rows:[{id:'sauce-part',food:state.foods[0],meal:'全天',grams:30,min:0,max:500,step:5,fixed:false}]}];
  const t=setup(state);
  try {
    await route(t,'templates');
    click(t,'[data-action="template-combo"]');
    assert.equal(t.$('#combo-form').elements.name.value,'吃鱼料汁');
    submit(t,'#combo-form');
    const combo=t.state().foods.find(f=>f.isComposite);
    assert.equal(combo.unitGrams,30);
    assert.equal(t.state().templates[0].rows[0].grams,30);
    await route(t,'today');
    click(t,'[data-action="add-food"][data-id="'+combo.id+'"]');
    assert.equal(Object.values(t.state().days)[0].plan.length,1);
  } finally {t.close();}
});

test("DOM：旧计划即时估费，采购价可编辑且刷新不被默认价覆盖", options, async () => {
  const t=setup(undefined,true);
  try {
    click(t,'[data-action="add-food"][data-id="reference-usda-01123"]');
    assert.match(t.$('.cost-summary').textContent,/0.70/);
    click(t,'[data-action="count-plus"]');
    assert.match(t.$('.cost-summary').textContent,/1.40/);
    const before=Object.values(t.state().days)[0].plan[0].food.kcal;
    await route(t,'foods');
    click(t,'[data-action="edit-food"][data-id="reference-usda-01123"]');
    const form=t.$('#food-form');
    assert.equal(form.elements.purchaseAmount.value,'20.99');
    assert.equal(form.elements.purchaseUnit.value,'count');
    form.elements.purchaseAmount.value='30';
    submit(t,'#food-form');
    await route(t,'today');
    assert.match(t.$('.cost-summary').textContent,/2.00/);
    assert.equal(Object.values(t.state().days)[0].plan[0].food.kcal,before);
    const restored=setup(t.state(),true);
    try { assert.equal(restored.state().foods.find(f=>f.id==='reference-usda-01123').purchase.amount,30); }
    finally {restored.close();}
  }finally{t.close();}
});

test("DOM：已有吃鱼料汁按原料当前价格显示每份费用，整份增减计入全天", options, async () => {
  const state=fixture();
  const ingredient=C.clone(state.foods[0]);
  ingredient.price=null;
  const combo=C.compositeFood('saved-fish-sauce','吃鱼料汁',[{food:ingredient,grams:50}]);
  state.foods[0].price=2;
  state.foods.push(combo);
  const t=setup(state);
  try{
    assert.match(t.$('.combo-cost').textContent,/每份.*1.00/);
    click(t,'[data-action="add-food"][data-id="saved-fish-sauce"]');
    assert.match(t.$('.cost-summary').textContent,/1.00/);
    click(t,'[data-action="count-plus"]');
    assert.match(t.$('.cost-summary').textContent,/2.00/);
    const row=Object.values(t.state().days)[0].plan[0];
    assert.equal(row.fixed,true);
    assert.equal(row.food.ingredients[0].food.price,null);
    await route(t,'foods');
    const libraryRow=t.all('tbody tr').find(r=>r.textContent.includes('吃鱼料汁'));
    assert.match(libraryRow.textContent,/每份.*1.00/);
  }finally{t.close();}
});

test("DOM：排序作用于配餐实际用量，未知末尾，仅点击排序才重排且保留计算数据", options, async () => {
  const state=fixture(),base=state.foods[0];
  state.foods=[
    {...base,id:'sort-a',name:'甲',kcal:100,protein:80,fat:10,carbs:20,price:10},
    {...base,id:'sort-b',name:'乙',kcal:20,protein:3,fat:5,carbs:4,price:0},
    {...base,id:'sort-c',name:'丙',kcal:null,protein:null,fat:null,carbs:null,price:null}
  ];
  const t=setup(state);
  const order=()=>t.all('.row-card .food-name').map(e=>e.textContent).join(',');
  try{
    assert.equal(t.$('#meal-sort-field'),null);
    assert.equal(t.$('#food-sort-field'),null);
    for(const id of ['sort-a','sort-b','sort-c'])click(t,'[data-action="add-food"][data-id="'+id+'"]');
    change(t,'[aria-label="甲克数"]','10');
    const plan=JSON.stringify(Object.values(t.state().days)[0].plan);
    change(t,'#meal-sort-field','kcal');
    assert.equal(order(),'甲,乙,丙');
    click(t,'[data-action="sort-meal"]');
    assert.equal(order(),'乙,甲,丙');
    assert.match(t.all('.sort-value')[0].textContent,/20 kcal/);
    change(t,'#meal-sort-direction','asc');
    click(t,'[data-action="sort-meal"]');
    assert.equal(order(),'甲,乙,丙');
    change(t,'#meal-sort-field','price');
    click(t,'[data-action="sort-meal"]');
    assert.equal(order(),'乙,甲,丙');
    change(t,'#meal-sort-direction','desc');
    click(t,'[data-action="sort-meal"]');
    assert.equal(order(),'甲,乙,丙');
    change(t,'#meal-sort-field','protein');
    click(t,'[data-action="sort-meal"]');
    assert.equal(order(),'甲,乙,丙');
    change(t,'#meal-sort-field','fat');
    click(t,'[data-action="sort-meal"]');
    assert.equal(order(),'乙,甲,丙');
    change(t,'#meal-sort-field','carbs');
    click(t,'[data-action="sort-meal"]');
    assert.equal(order(),'乙,甲,丙');
    assert.equal(JSON.stringify(Object.values(t.state().days)[0].plan),plan);
    change(t,'[aria-label="甲克数"]','100');
    assert.equal(order(),'乙,甲,丙');
    click(t,'[data-action="sort-meal"]');
    assert.equal(order(),'甲,乙,丙');
    const restored=setup(t.state());
    try{assert.equal(restored.$('#meal-sort-field').value,'carbs'); assert.equal(restored.$('#meal-sort-direction').value,'desc');}
    finally{restored.close();}
    await route(t,'foods');
    assert.equal(t.$('#meal-sort-field'),null);
    assert.equal(t.$('#food-sort-field'),null);
  }finally{t.close();}
});

test("DOM：每日体重补记、更新、删除与备份恢复，保留饮食和营养目标", options, async () => {
  const initial=fixture(); delete initial.weights;
  const t=setup(initial);
  try {
    const before=t.state();
    await route(t,'weights');
    assert.ok(t.$('#weight-form'));
    change(t,'#weight-date','2024-02-29');
    let form=t.$('#weight-form');
    form.elements.jin.value='138'; form.elements.waist.value='87.5'; form.elements.note.value='<img src=x onerror=alert(1)>';
    submit(t,'#weight-form');
    assert.equal(t.state().weights['2024-02-29'].kg,69);
    assert.ok(t.$('.weight-stats').textContent.includes('138.00 斤'));
    assert.ok(t.$('.weight-chart').textContent.includes('单位斤'));
    assert.equal(t.state().weights['2024-02-29'].waist,87.5);
    assert.equal(t.all('.weight-layout img').length,0);
    assert.equal(t.all('.weight-chart circle').length,1);
    assert.equal(t.$('.weight-chart').outerHTML.includes('NaN'),false);
    assert.deepEqual(t.state().profiles,before.profiles);
    form=t.$('#weight-form'); form.elements.jin.value='137.6';
    submit(t,'#weight-form');
    assert.equal(Object.keys(t.state().weights).length,1);
    assert.equal(t.state().weights['2024-02-29'].kg,68.8);
    click(t,'#backup-top');
    const saved=t.downloads.at(-1);
    assert.equal(JSON.parse(saved).weights['2024-02-29'].kg,68.8);
    click(t,'[data-action="delete-weight"]');
    assert.equal(Object.keys(t.state().weights).length,0);
    Object.defineProperty(t.$('#import-file'),'files',{value:[{size:saved.length,text:async()=>saved}],configurable:true});
    t.$('#import-file').dispatchEvent(new t.w.Event('change')); await tick();
    assert.equal(t.state().weights['2024-02-29'].kg,68.8);
    const refreshed=setup(t.state());
    try { await route(refreshed,'weights'); change(refreshed,'#weight-date','2024-02-29'); assert.equal(refreshed.$('#weight-form').elements.jin.value,'137.6'); }
    finally { refreshed.close(); }
    assert.deepEqual(t.state().profiles,before.profiles);
    assert.deepEqual(t.state().foods,before.foods);
  } finally {t.close();}
});

test("DOM：纤维字段可编辑，配餐和组合套餐按用量汇总，备份保留缺失标记", options, async () => {
  const t=setup(fixture());
  try {
    await route(t,'foods');
    assert.ok(t.$('.library-table').textContent.includes('膳食纤维'));
    click(t,'[data-action="edit-food"]');
    const form=t.$('#food-form');
    assert.equal(form.elements.fiber.value,'0');
    assert.equal(form.elements.fiberEstimated.checked,true);
    form.elements.fiber.value='5';
    form.elements.fiber.dispatchEvent(new t.w.Event('input',{bubbles:true}));
    assert.equal(form.elements.fiberEstimated.checked,false);
    submit(t,'#food-form');
    assert.equal(t.state().foods[0].fiber,5);
    await route(t,'today');
    click(t,'[data-action="add-food"]');
    change(t,'[data-field="grams"]','50');
    assert.match(t.$('.fiber-summary').textContent,/2.5g/);
    click(t,'[data-action="new-combo"]');
    t.$('#combo-form').elements.name.value='纤维组合';
    t.$('.combo-ingredient input').value='40';
    submit(t,'#combo-form');
    const combo=t.state().foods.find(f=>f.isComposite);
    assert.equal(combo.fiber,5);
    click(t,'[data-action="add-food"][data-id="'+combo.id+'"]');
    assert.match(t.$('.fiber-summary').textContent,/4.5g/);
    click(t,'#backup-top');
    const backup=JSON.parse(t.downloads.at(-1));
    assert.equal(C.validateState(backup).foods[0].fiber,5);
    assert.equal(backup.foods[0].fiberEstimated,false);
  }finally{t.close();}
});

test("DOM：单项实际碳蛋脂热与费用随重量、求解和实际记录更新", options, async () => {
  const initial=fixture(); initial.foods[0].price=2;
  const t=setup(initial);
  const value=key=>t.$('.row-nutrients [data-nutrient="'+key+'"] dd').textContent;
  try{
    click(t,'[data-action="add-food"]');
    change(t,'[data-field="grams"]','125');
    assert.equal(value('kcal'),'125 kcal');
    assert.equal(value('protein'),'12.5g');
    assert.equal(value('fat'),'2.5g');
    assert.equal(value('carbs'),'12.5g');
    assert.equal(value('cost'),'¥2.50');
    click(t,'#solve');
    for(let i=0;i<40 && t.$('#solve').disabled;i++) await tick();
    assert.equal(t.$('#solve').disabled,false);
    assert.equal(value('kcal'),'200 kcal');
    assert.equal(value('protein'),'20g');
    assert.equal(value('fat'),'4g');
    assert.equal(value('carbs'),'20g');
    assert.equal(value('cost'),'¥4.00');
    click(t,'[data-action="copy-actual"]');
    await route(t,'records');
    change(t,'[data-field="grams"][data-actual="true"]','150');
    assert.equal(value('kcal'),'150 kcal');
    assert.equal(value('cost'),'¥3.00');
    assert.equal(Object.values(t.state().days)[0].plan[0].grams,200);
  }finally{t.close();}
});

test("DOM：GitHub模式加载全部云端数据、保存且不写本地个人数据，令牌不进入JSON", options, async () => {
  const local=fixture(), remote=fixture(); remote.foods[0].name='云端食物'; C.fillFiberDefaults(remote.foods);
  remote.weights={'2024-02-29':{kg:69,waist:87.5,note:'晨起'}};
  let document=remote,sha='one',uploaded=null;
  const config={owner:'example',repo:'private-data',branch:'main',path:'personal-data.json'};
  const t=setup(local,false,{config,token:'test-session-token',fetch:async(url,options)=>{
    if(options.method==='GET')return{ok:true,json:async()=>({sha,encoding:'base64',content:require('../github-sync.js').encode(JSON.stringify(document))})};
    const body=JSON.parse(options.body); assert.equal(body.sha,sha); sha='two';
    uploaded=JSON.parse(require('../github-sync.js').decode(body.content)); document=uploaded;
    return{ok:true,json:async()=>({content:{sha}})};
  }});
  try{
    const localBefore=t.w.localStorage.getItem('qingpan.v1');
    assert.ok(t.$('#cloud-form')); assert.equal(t.$('[data-action="add-food"]'),null);
    click(t,'[data-action="cloud-load"]'); await tick();
    assert.ok(t.$('#picker').textContent.includes('云端食物'));
    click(t,'[data-action="add-food"]');
    assert.match(t.$('#cloud-status-text').textContent,/未保存/);
    assert.equal(t.w.localStorage.getItem('qingpan.v1'),localBefore);
    click(t,'[data-action="cloud-save"]'); await tick();
    assert.equal(Object.values(uploaded.days)[0].plan.length,1);
    assert.equal(uploaded.weights['2024-02-29'].kg,69);
    assert.equal(JSON.stringify(uploaded).includes('test-session-token'),false);
    assert.equal(t.w.localStorage.getItem('qingpan.v1'),localBefore);
    assert.match(t.$('#cloud-status-text').textContent,/已同步/);
  }finally{t.close();}
});

test("DOM：配置GitHub并首次迁移本机数据，连接信息与令牌不进入个人JSON", options, async () => {
  const t=setup(fixture()); let uploaded;
  t.w.fetch=async(url,options)=>options.method==='GET'?{ok:false,status:404}:{ok:true,json:async()=>{uploaded=JSON.parse(require('../github-sync.js').decode(JSON.parse(options.body).content));return{content:{sha:'first'}};}};
  try{
    await route(t,'settings');
    const before=t.w.localStorage.getItem('qingpan.v1');
    const form=t.$('#cloud-form');
    for(const [k,v]of Object.entries({owner:'example',repo:'private-data',branch:'main',path:'personal-data.json',token:'test-session-token'}))form.elements[k].value=v;
    submit(t,'#cloud-form');
    assert.equal(t.$('[data-action="add-food"]'),null);
    click(t,'[data-action="cloud-create"]'); await tick();
    assert.equal(uploaded.foods[0].name,'数学测试食物');
    assert.equal(JSON.stringify(uploaded).includes('test-session-token'),false);
    assert.equal(t.w.localStorage.getItem('qingpan.v1'),before);
    assert.equal(t.w.localStorage.getItem('qingpan.githubConfig').includes('test-session-token'),false);
    assert.match(t.$('#cloud-status-text').textContent,/已同步/);
  }finally{t.close();}
});

test("DOM：体重趋势点支持悬停、手机点击与键盘，提示日期和斤且不修改记录", options, async () => {
  const state=fixture();state.weights={'2024-02-29':{kg:69},'2024-03-01':{kg:68.8}};
  const t=setup(state);
  try{
    await route(t,'weights');change(t,'#weight-date','2024-03-01');
    const before=JSON.stringify(t.state().weights);
    const points=t.all('.weight-point'),tip=t.$('#weight-point-tooltip');
    assert.equal(points.length,2);assert.equal(tip.hidden,true);
    points[0].dispatchEvent(new t.w.Event('pointerover',{bubbles:true}));
    assert.equal(tip.hidden,false);assert.match(tip.textContent,/2024-02-29/);assert.match(tip.textContent,/138.00 斤/);
    points[0].dispatchEvent(new t.w.Event('pointerout',{bubbles:true}));
    assert.equal(tip.hidden,true);
    points[1].dispatchEvent(new t.w.MouseEvent('click',{bubbles:true}));
    assert.match(tip.textContent,/2024-03-01/);assert.match(tip.textContent,/137.60 斤/);
    points[1].dispatchEvent(new t.w.Event('pointerout',{bubbles:true}));assert.equal(tip.hidden,false);
    points[1].dispatchEvent(new t.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(tip.hidden,true);
    points[0].dispatchEvent(new t.w.FocusEvent('focusin',{bubbles:true}));assert.equal(tip.hidden,false);
    points[0].dispatchEvent(new t.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(tip.dataset.pinned,'true');
    t.w.document.body.dispatchEvent(new t.w.MouseEvent('click',{bubbles:true}));assert.equal(tip.hidden,true);
    assert.equal(JSON.stringify(t.state().weights),before);
  }finally{t.close();}
});

test("DOM：跨天唤醒回到本地今天，昨日饮食保留，今日新记录刷新后仍存在", options, async () => {
  const clock={now:new Date(2026,10,22,23,59).getTime()};
  const t=setup(fixture(),false,null,clock);
  try{
    click(t,'[data-action="add-food"]');click(t,'[data-action="copy-actual"]');
    assert.equal(t.state().days['2026-11-22'].actual.length,1);
    assert.match(t.$('#toast').textContent,/已保存到本机：2026-11-22/);
    clock.now=new Date(2026,10,23,0,1).getTime();
    t.w.dispatchEvent(new t.w.Event('focus'));
    assert.equal(t.$('#date').value,'2026-11-23');
    assert.match(t.$('.diary-date-notice').textContent,/2026-11-23（今天）/);
    assert.equal(t.all('.row-card').length,0);
    click(t,'[data-action="add-food"]');change(t,'[data-field="grams"]','150');click(t,'[data-action="copy-actual"]');
    assert.equal(t.state().days['2026-11-23'].actual[0].grams,150);
    assert.equal(t.state().days['2026-11-22'].actual[0].grams,100);
    const refreshed=setup(t.state(),false,null,clock);
    try{await route(refreshed,'records');assert.equal(refreshed.$('#date').value,'2026-11-23');assert.equal(refreshed.$('[data-field="grams"]').value,'150');}
    finally{refreshed.close();}
  }finally{t.close();}
});

test("DOM：查看昨天后点今日导航不会沿用昨天，显式编辑历史仍可补记", options, async () => {
  const clock={now:new Date(2026,10,23,12).getTime()},state=fixture();
  const row={id:'old-plan',food:state.foods[0],meal:'全天',grams:75,min:0,max:500,step:5,fixed:false};
  state.days['2026-11-22']={meals:['全天'],target:state.profiles[0],plan:[row],actual:[]};
  const t=setup(state,false,null,clock);
  try{
    click(t,'[data-action="add-food"]');click(t,'[data-action="copy-actual"]');
    await route(t,'records');change(t,'#date','2026-11-22');
    assert.match(t.$('.diary-date-notice').textContent,/历史或指定日期/);
    t.$('#nav a[href="#today"]').dispatchEvent(new t.w.MouseEvent('click',{bubbles:true,cancelable:true}));await tick();
    for(let i=0;i<40 && t.$('#date').value!=='2026-11-23';i++) await tick();
    assert.equal(t.$('#date').value,'2026-11-23');
    await route(t,'records');change(t,'#date','2026-11-22');
    click(t,'[data-action="go-today"]');await tick();
    assert.equal(t.$('#date').value,'2026-11-22');
    t.w.confirm=()=>false;click(t,'[data-action="copy-actual"]');
    assert.equal(t.state().days['2026-11-22'].actual.length,0);
    t.w.confirm=()=>true;click(t,'[data-action="copy-actual"]');
    assert.equal(t.state().days['2026-11-22'].actual[0].grams,75);
    click(t,'[data-action="diary-today"]');assert.equal(t.$('#date').value,'2026-11-23');
    assert.equal(t.state().days['2026-11-23'].actual[0].grams,100);
  }finally{t.close();}
});

test("DOM：保存失败不能提示成功，也不覆盖已有本地记录", options, async () => {
  const t=setup(fixture());
  try{
    click(t,'[data-action="add-food"]');
    const before=t.w.localStorage.getItem('qingpan.v1');
    const original=t.w.Storage.prototype.setItem;
    t.w.Storage.prototype.setItem=function(){throw Error('quota');};
    click(t,'[data-action="copy-actual"]');
    assert.match(t.$('#toast').textContent,/保存失败/);
    assert.equal(t.w.localStorage.getItem('qingpan.v1'),before);
    t.w.Storage.prototype.setItem=original;
  }finally{t.close();}
});

test("DOM：绑定实际JSON后自动保存，清缓存后从同一文件恢复全部饮食", options, async () => {
  let disk='';
  const handle={name:'个人数据.json',getFile:async()=>{const snapshot=disk;return{text:async()=>snapshot};},createWritable:async()=>{let pending;return{write:async text=>{pending=text;},close:async()=>{disk=pending;},abort:async()=>{}};}};
  const file={save:async()=>handle,open:async()=>[handle]};
  const t=setup(fixture(),false,null,null,file);
  try{
    click(t,'[data-action="file-create"]');await tick();
    assert.match(t.$('#file-status-text').textContent,/已保存到文件/);
    t.w.localStorage.clear();
    click(t,'[data-action="add-food"]');click(t,'[data-action="copy-actual"]');await tick();
    const saved=JSON.parse(disk),day=Object.values(saved.days).find(d=>d.actual.length);
    assert.equal(day.actual[0].grams,100);
    assert.equal(t.w.localStorage.getItem('qingpan.v1'),null);
    const reopened=setup(undefined,false,null,null,file);
    try{click(reopened,'[data-action="file-open"]');await tick();await route(reopened,'records');assert.equal(reopened.$('[data-field="grams"]').value,'100');}
    finally{reopened.close();}
  }finally{t.close();}
});

test("DOM：文件模式刷新后需重新选文件，不显示旧缓存；失败时不能假报已保存", options, async () => {
  let disk=JSON.stringify(fixture()),fail=false;
  const handle={name:'data.json',getFile:async()=>({text:async()=>disk}),createWritable:async()=>{if(fail)throw Error('permission');let pending;return{write:async text=>pending=text,close:async()=>{disk=pending;},abort:async()=>{}};}};
  const t=setup(fixture(),false,null,null,{mode:true,open:async()=>[handle],save:async()=>handle});
  try{
    assert.equal(t.$('#picker'),null);
    click(t,'[data-action="file-open"]');await tick();
    const before=disk;fail=true;
    click(t,'[data-action="add-food"]');click(t,'[data-action="copy-actual"]');await tick();
    assert.match(t.$('#file-status-text').textContent,/保存失败/);
    assert.equal(disk,before);
    assert.equal(t.all('.row-card').length,1);
  }finally{t.close();}
});

test("DOM：文件未连接时导航明确显示目标页面，取消后可重试且连接后进入该页面", options, async () => {
  const initial=fixture(), before=JSON.stringify(initial);
  let cancel=true, disk=before;
  const handle={name:'轻盘备份.json',getFile:async()=>({text:async()=>disk}),createWritable:async()=>{let pending;return{write:async text=>pending=text,close:async()=>{disk=pending;}};}};
  const t=setup(initial,false,null,null,{mode:true,open:async()=>{if(cancel)throw new t.w.DOMException('取消','AbortError');return[handle];},save:async()=>handle});
  try{
    for(const [page,title] of [['settings','个人设置'],['templates','我的套餐'],['foods','食物库']]){
      await route(t,page);
      assert.equal(t.$('#app h1').textContent,title);
      assert.match(t.$('#app').textContent,/JSON文件尚未打开/);
      assert.equal(t.$('#picker'),null);
    }
    click(t,'[data-action="file-open"]');await tick();
    assert.match(t.$('#app').textContent,/JSON文件尚未打开/);
    assert.equal(t.w.localStorage.getItem('qingpan.v1'),before);
    assert.equal(disk,before);
    cancel=false;click(t,'[data-action="file-open"]');await tick();
    assert.equal(t.w.location.hash,'#foods');
    assert.doesNotMatch(t.$('#app').textContent,/JSON文件尚未打开/);
    assert.match(t.$('#app').textContent,/数学测试食物/);
    assert.match(t.$('#file-status-text').textContent,/已保存到文件/);
  }finally{t.close();}
});

test("DOM：本地服务自动读取固定文件、自动保存，空浏览器重新打开也无需选文件", options, async () => {
  const os=require('node:os'),{createServer}=require('../server.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qingpan-ui-')),dataFile=path.join(dir,'data.json');
  const data=fixture();data.templates=[{id:'disk-template',name:'磁盘套餐',rows:[],meals:['全天'],target:data.profiles[0]}];
  fs.writeFileSync(dataFile,JSON.stringify(data));
  const server=createServer({dataFile});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const file={server:true,fetch:(url,options={})=>fetch(base+url,{...options,headers:{...options.headers,Origin:base}})};
  let t;
  try {
    t=setup(undefined,false,null,null,file);
    for(let i=0;i<30&&!t.$('#picker');i++)await tick();
    assert.ok(t.$('#picker'));assert.equal(t.w.localStorage.getItem('qingpan.v1'),null);
    click(t,'[data-action="add-food"]');click(t,'[data-action="copy-actual"]');
    for(let i=0;i<30&&!Object.values(JSON.parse(fs.readFileSync(dataFile)).days).some(d=>d.actual.length);i++)await tick();
    for(let i=0;i<30&&!t.$('#file-status-text').textContent.startsWith('全部数据已保存');i++)await tick();
    assert.ok(Object.values(JSON.parse(fs.readFileSync(dataFile)).days).some(d=>d.actual[0]?.grams===100));
    assert.equal(t.w.localStorage.getItem('qingpan.v1'),null);
    t.close();t=setup(undefined,false,null,null,file);
    for(let i=0;i<30&&!t.$('#picker');i++)await tick();
    await route(t,'templates');assert.match(t.$('#app').textContent,/磁盘套餐/);
    await route(t,'records');assert.equal(t.$('[data-field="grams"]').value,'100');
    await route(t,'settings');assert.match(t.$('#app').textContent,/固定JSON文件自动保存/);
    assert.equal(t.$('[data-action="file-create"]'),null);
  } finally {t?.close();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
