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
function setup(initial, withBuiltin = false) {
  const dom = new JSDOM(
      fs.readFileSync(path.join(root, "index.html"), "utf8"),
      { url: "http://localhost/", runScripts: "outside-only" },
    ),
    w = dom.window;
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
  for (const f of [
    "vendor/solver.js",
    "core.js",
    "solver-client.js",
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

test("DOM：排序作用于配餐实际用量，未知末尾，克数变化重新排序且保留计算数据", options, async () => {
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
    assert.equal(order(),'乙,甲,丙');
    assert.match(t.all('.sort-value')[0].textContent,/20 kcal/);
    change(t,'#meal-sort-direction','asc');
    assert.equal(order(),'甲,乙,丙');
    change(t,'#meal-sort-field','price');
    assert.equal(order(),'乙,甲,丙');
    change(t,'#meal-sort-direction','desc');
    assert.equal(order(),'甲,乙,丙');
    change(t,'#meal-sort-field','protein');
    assert.equal(order(),'甲,乙,丙');
    change(t,'#meal-sort-field','fat');
    assert.equal(order(),'乙,甲,丙');
    change(t,'#meal-sort-field','carbs');
    assert.equal(order(),'乙,甲,丙');
    assert.equal(JSON.stringify(Object.values(t.state().days)[0].plan),plan);
    change(t,'[aria-label="甲克数"]','100');
    assert.equal(order(),'甲,乙,丙');
    const restored=setup(t.state());
    try{assert.equal(restored.$('#meal-sort-field').value,'carbs'); assert.equal(restored.$('#meal-sort-direction').value,'desc');}
    finally{restored.close();}
    await route(t,'foods');
    assert.equal(t.$('#meal-sort-field'),null);
    assert.equal(t.$('#food-sort-field'),null);
  }finally{t.close();}
});
