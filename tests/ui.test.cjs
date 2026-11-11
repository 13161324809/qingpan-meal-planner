// Optional DOM integration tests: npm install --ignore-scripts, then npm run test:ui.
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
let JSDOM;
try {
  ({ JSDOM } = require(process.env.QINGPAN_JSDOM || "jsdom"));
} catch {}
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
  w.Worker = undefined;
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
      assert.equal(copy.$('select[data-field="meal"]').value, "第一餐");
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
    assert.equal(t.$('select[data-field="meal"]').value, "旧餐次");
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
      assert.equal(t.state().foods.length, 14);
      assert.equal(t.state().builtinFoodsSeen.length, 14);
      await route(t, "foods");
      click(t, '[data-action="edit-food"]');
      t.$("#food-form").elements.name.value = "我修改过的挂面";
      t.$("#food-form").elements.energy.value = "360";
      submit(t, "#food-form");
      const deleteButtons = t.all('[data-action="delete-food"]');
      deleteButtons[1].click();
      const after = t.state();
      assert.equal(after.foods.length, 13);
      const refreshed = setup(after, true);
      try {
        assert.equal(refreshed.state().foods.length, 13);
        assert.equal(refreshed.state().foods[0].name, "我修改过的挂面");
        assert.equal(refreshed.state().foods[0].kcal, 360);
        await route(refreshed, "foods");
        click(refreshed, '[data-action="restore-builtin"]');
        assert.equal(refreshed.state().foods.length, 14);
        assert.equal(refreshed.state().foods[0].kcal, 360);
        click(refreshed, '[data-action="restore-builtin"]');
        assert.equal(refreshed.state().foods.length, 14);
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
