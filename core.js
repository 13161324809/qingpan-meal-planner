/* Pure calculations and MILP construction. No DOM or storage dependency. */
(function (root) {
  "use strict";
  const keys = ["kcal", "protein", "fat", "carbs", "sodium"];
  const labels = {
    kcal: "热量",
    protein: "蛋白质",
    fat: "脂肪",
    carbs: "碳水",
    sodium: "钠",
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const number = (x) => typeof x === "number" && Number.isFinite(x);
  const nonneg = (x) => number(x) && x >= 0;
  const kjToKcal = (kj) => kj / 4.184;
  const sodiumEnabled = (t) => t?.enforceSodium === true;
  const constraintKeys = (t) =>
    keys.filter((k) => k !== "sodium" || sodiumEnabled(t));
  function validateFood(f) {
    if (
      !f ||
      typeof f.id !== "string" ||
      !f.id ||
      typeof f.name !== "string" ||
      !f.name.trim()
    )
      throw Error("食物名称或编号无效");
    for (const k of keys)
      if (f[k] !== null && !nonneg(f[k]))
        throw Error(`${f.name}：${labels[k]}必须为非负数或留空`);
    if (!number(f.edibleRatio) || f.edibleRatio <= 0 || f.edibleRatio > 1)
      throw Error("可食比例必须大于0且不超过100%");
    if (!["edible", "weighed"].includes(f.nutritionBasis))
      throw Error("营养标示口径无效");
    if (typeof f.weightMode !== "string" || !f.weightMode.trim())
      throw Error("请填写称重口径");
    if (f.unitGrams !== null && (!number(f.unitGrams) || f.unitGrams <= 0))
      throw Error("每个重量必须大于0");
    if (f.price !== null && !nonneg(f.price)) throw Error("单价无效");
    return f;
  }
  function factor(f) {
    return f.nutritionBasis === "edible" ? f.edibleRatio : 1;
  }
  function mergeFoodPack(state, pack) {
    if (
      !pack ||
      pack.type !== "qingpan-foods" ||
      pack.version !== 1 ||
      !Array.isArray(pack.foods) ||
      pack.foods.length > 10000
    )
      throw Error("不是有效的轻盘食物包（qingpan-foods v1）");
    const ids = new Set();
    for (const f of pack.foods) {
      validateFood(f);
      if (ids.has(f.id)) throw Error("食物包包含重复编号");
      ids.add(f.id);
    }
    const next = clone(state);
    const identity = (f) =>
      [f.name, f.brand || "", f.flavor || "", f.weightMode]
        .map((x) => x.trim().toLowerCase())
        .join("\u0000");
    const knownIds = new Set(next.foods.map((f) => f.id));
    const knownNames = new Set(next.foods.map(identity));
    let added = 0,
      skipped = 0;
    for (const f of pack.foods) {
      if (knownIds.has(f.id) || knownNames.has(identity(f))) {
        skipped++;
        continue;
      }
      next.foods.push(clone(f));
      knownIds.add(f.id);
      knownNames.add(identity(f));
      added++;
    }
    return { state: next, added, skipped };
  }
  function installBuiltinFoods(state, pack) {
    // Validate the complete catalog before touching any existing state.
    mergeFoodPack(initialState(), pack);
    const seen = new Set(state.builtinFoodsSeen || []);
    const unseen = pack.foods.filter((f) => !seen.has(f.id));
    const result = mergeFoodPack(state, { ...pack, foods: unseen });
    result.state.builtinFoodsSeen = [
      ...new Set([...seen, ...pack.foods.map((f) => f.id)]),
    ];
    result.changed =
      result.added > 0 || result.state.builtinFoodsSeen.length !== seen.size;
    return result;
  }
  function totals(rows) {
    const out = Object.fromEntries(keys.map((k) => [k, 0]));
    out.unknown = [];
    for (const r of rows) {
      if (!nonneg(r.grams)) throw Error("重量必须为非负数");
      for (const k of keys) {
        if (r.food[k] === null || !nonneg(r.food[k])) {
          if (r.grams > 0 && !out.unknown.includes(k)) out.unknown.push(k);
        } else out[k] += (r.food[k] * r.grams * factor(r.food)) / 100;
      }
    }
    return out;
  }
  function targetBounds(t) {
    if (!t || typeof t.autoCarbs !== "boolean") throw Error("自动碳水设置无效");
    if (t.enforceSodium !== undefined && typeof t.enforceSodium !== "boolean")
      throw Error("严格限钠设置无效");
    if (t.sodium !== undefined && t.sodium !== null && !nonneg(t.sodium))
      throw Error("钠上限须为非负数或留空");
    if (sodiumEnabled(t) && !nonneg(t.sodium))
      throw Error("开启严格限钠时，请填写有效的钠上限");
    for (const k of [
      "kcal",
      "protein",
      "fat",
      "carbs",
      "energyTolerance",
      "fatTolerance",
      "carbTolerance",
    ])
      if (!nonneg(t[k])) throw Error("目标和允许差额必须为非负数");
    if (t.kcal <= 0 || t.energyTolerance > 100)
      throw Error("热量须大于0，热量允许偏差须在0–100%");
    const carbs = t.autoCarbs
      ? (t.kcal - t.protein * 4 - t.fat * 9) / 4
      : t.carbs;
    if (carbs < 0)
      throw Error("蛋白质与脂肪目标折算热量已超过总热量，无法自动计算剩余碳水");
    return {
      kcal: {
        min: t.kcal * (1 - t.energyTolerance / 100),
        max: t.kcal * (1 + t.energyTolerance / 100),
        target: t.kcal,
      },
      protein: { min: t.protein, target: t.protein },
      fat: {
        min: Math.max(0, t.fat - t.fatTolerance),
        max: t.fat + t.fatTolerance,
        target: t.fat,
      },
      carbs: {
        min: Math.max(0, carbs - t.carbTolerance),
        max: carbs + t.carbTolerance,
        target: carbs,
      },
      sodium: sodiumEnabled(t) ? { max: t.sodium, target: t.sodium } : {},
    };
  }
  function validateRows(rows, meals, t = {}) {
    if (!rows.length) throw Error("请先从食物库添加今天想吃的食物");
    if (rows.length > 60)
      throw Error("每次配餐最多支持60条食物，请合并重复条目");
    const ids = new Set();
    for (const r of rows) {
      if (!r || typeof r.id !== "string" || ids.has(r.id))
        throw Error("食物条目编号重复或无效");
      ids.add(r.id);
      validateFood(r.food);
      const missing = constraintKeys(t).filter((k) => r.food[k] === null);
      if (missing.length)
        throw Error(
          `${r.food.name}缺少${missing.map((k) => labels[k]).join("、")}数据，请补全后配餐`,
        );
      if (!meals.includes(r.meal)) throw Error("食物餐次已不存在，请重新分配");
      if (
        ![r.min, r.max, r.grams].every(nonneg) ||
        r.max < r.min ||
        r.max > 10000
      )
        throw Error(`${r.food.name}：重量范围须在0–10000g，且下限不高于上限`);
      if (![1, 5, 10].includes(r.step))
        throw Error("取整单位只支持1g、5g或10g");
      if (typeof r.fixed !== "boolean") throw Error("固定重量模式无效");
      if (r.fixed && (r.grams < r.min || r.grams > r.max))
        throw Error(`${r.food.name}固定重量不在最小和最大范围内`);
      if (!r.fixed && Math.ceil(r.min / r.step) > Math.floor(r.max / r.step))
        throw Error(
          `${r.food.name}的范围内没有${r.step}g的整数倍，请调整范围或步长`,
        );
    }
  }
  function violations(rows, t) {
    const b = targetBounds(t),
      sum = totals(rows),
      issues = [];
    for (const k of constraintKeys(t)) {
      if (sum.unknown.includes(k)) {
        issues.push(`${labels[k]}数据不完整`);
        continue;
      }
      const unit = k === "kcal" ? "kcal" : k === "sodium" ? "mg" : "g";
      if (b[k].min !== undefined && sum[k] < b[k].min - 1e-5)
        issues.push(
          `${labels[k]}不足 ${(b[k].min - sum[k]).toFixed(1)} ${unit}（下限 ${b[k].min.toFixed(1)}）`,
        );
      if (b[k].max !== undefined && sum[k] > b[k].max + 1e-5)
        issues.push(
          `${labels[k]}超出 ${(sum[k] - b[k].max).toFixed(1)} ${unit}（上限 ${b[k].max.toFixed(1)}）`,
        );
    }
    return issues;
  }
  function scaleTargetCalories(target, kcal) {
    targetBounds(target);
    if (!number(kcal) || kcal <= 0 || kcal > 100000)
      throw Error("目标热量须在0–100000 kcal之间，且大于0");
    const result = clone(target),
      ratio = kcal / target.kcal;
    result.kcal = kcal;
    for (const k of [
      "protein",
      "fat",
      "carbs",
      "fatTolerance",
      "carbTolerance",
    ])
      result[k] *= ratio;
    targetBounds(result);
    return result;
  }
  function buildModel(rows, t, variant, relaxed = false) {
    const b = targetBounds(t);
    if (variant === "B" && !sodiumEnabled(t)) variant = "A";
    const model = {
      optimize: "cost",
      opType: "min",
      constraints: {},
      variables: {},
      ints: {},
      options: { timeout: 1800, tolerance: 0, presolve: true },
    };
    const weights =
      variant === "A"
        ? { kcal: 12, protein: 14, fat: 2, carbs: 2 }
        : variant === "B"
          ? { kcal: 3, protein: 4, fat: 1, carbs: 1 }
          : { kcal: 4, protein: 5, fat: 2, carbs: 2 };
    rows.forEach((r, i) => {
      const scale = r.fixed ? 1 : r.step;
      const v = {
        cost:
          0.000001 +
          (variant === "B"
            ? ((r.food.sodium * factor(r.food) * scale) /
                100 /
                Math.max(t.sodium, 1)) *
              8
            : 0),
      };
      for (const k of constraintKeys(t)) {
        v[k] = (r.food[k] * factor(r.food) * scale) / 100;
        v["aim_" + k] = v[k];
      }
      v["portion_" + i] = scale;
      model.constraints["portion_" + i] = r.fixed
        ? { equal: r.grams }
        : {
            min: Math.ceil(r.min / r.step) * r.step,
            max: Math.floor(r.max / r.step) * r.step,
          };
      if (!r.fixed) model.ints["x" + i] = 1;
      model.variables["x" + i] = v;
      // Balance normalized portion positions: keep each near the midpoint of its own bounds.
      if (variant === "C" && !r.fixed) {
        const c = "balance_" + i;
        model.constraints[c] = { equal: (r.min + r.max) / 2 };
        v[c] = scale;
        model.variables["bl" + i] = {
          [c]: 1,
          cost: 3 / Math.max(1, r.max - r.min),
        };
        model.variables["bh" + i] = {
          [c]: -1,
          cost: 3 / Math.max(1, r.max - r.min),
        };
      }
    });
    if (variant === "C") {
      const free = rows
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => !r.fixed && r.max > r.min);
      const anchor = free[0];
      for (const { r, i } of free.slice(1)) {
        const c = "spread_" + i,
          a = anchor.r;
        model.constraints[c] = {
          equal: r.min / (r.max - r.min) - a.min / (a.max - a.min),
        };
        model.variables["x" + i][c] = r.step / (r.max - r.min);
        model.variables["x" + anchor.i][c] = -a.step / (a.max - a.min);
        model.variables["spreadLow" + i] = { [c]: 1, cost: 6 };
        model.variables["spreadHigh" + i] = { [c]: -1, cost: 6 };
      }
    }
    for (const k of constraintKeys(t)) {
      model.constraints[k] = {};
      if (b[k].min !== undefined) model.constraints[k].min = b[k].min;
      if (b[k].max !== undefined) model.constraints[k].max = b[k].max;
      if (relaxed) {
        // Separate lower and upper constraints so each slack is one-sided.
        delete model.constraints[k];
        for (const side of ["min", "max"])
          if (b[k][side] !== undefined) {
            const c = k + "_" + side;
            model.constraints[c] = { [side]: b[k][side] };
            rows.forEach(
              (_, i) =>
                (model.variables["x" + i][c] = model.variables["x" + i][k]),
            );
            model.variables["slack_" + c] = {
              [c]: side === "min" ? 1 : -1,
              cost: 10000 / Math.max(b[k].target, 1),
            };
          }
      }
      if (k !== "sodium") {
        const c = "aim_" + k;
        model.constraints[c] = { equal: b[k].target };
        const cost = weights[k] / Math.max(1, b[k].target);
        model.variables["under_" + k] = { [c]: 1, cost };
        model.variables["over_" + k] = { [c]: -1, cost };
      }
    }
    return model;
  }
  function solve(rows, t, meals, variant, solver) {
    validateRows(rows, meals, t);
    targetBounds(t);
    const start = Date.now();
    let relaxed = false;
    let result = solver.Solve(buildModel(rows, t, variant));
    if (!result.feasible) {
      relaxed = true;
      result = solver.Solve(buildModel(rows, t, variant, true));
    }
    if (!result.feasible || !result.bounded)
      return {
        variant,
        rows: [],
        issues: [
          "未找到可验证的整数解，可能为约束冲突或搜索达到时限；可缩小食物范围、减小步长后重试。",
        ],
        valid: false,
      };
    const output = clone(rows);
    output.forEach((r, i) => {
      const x = result["x" + i] || 0;
      r.grams = r.fixed ? r.grams : Math.round(x) * r.step;
    });
    // Independent post-solve verification: never trust solver flags alone.
    for (let i = 0; i < rows.length; i++) {
      const r = output[i];
      const raw = result["x" + i] || 0;
      if (
        (!r.fixed && Math.abs(raw - Math.round(raw)) > 1e-5) ||
        r.grams < r.min - 1e-5 ||
        r.grams > r.max + 1e-5
      )
        return {
          variant,
          rows: [],
          issues: ["求解器未返回可验证的整数重量，请调整范围重试。"],
          valid: false,
        };
    }
    const issues = violations(output, t);
    const diagnostics = [];
    if (issues.length) {
      const b = targetBounds(t);
      for (const k of constraintKeys(t)) {
        let lo = 0,
          hi = 0;
        rows.forEach((r) => {
          const a = (r.food[k] * factor(r.food)) / 100;
          lo += a * (r.fixed ? r.grams : Math.ceil(r.min / r.step) * r.step);
          hi += a * (r.fixed ? r.grams : Math.floor(r.max / r.step) * r.step);
        });
        if (b[k].min !== undefined && hi < b[k].min - 1e-5)
          diagnostics.push(
            `按当前最大份量，${labels[k]}最多${hi.toFixed(1)}，低于下限${b[k].min.toFixed(1)}`,
          );
        if (b[k].max !== undefined && lo > b[k].max + 1e-5)
          diagnostics.push(
            `按固定重量和最小份量，${labels[k]}至少${lo.toFixed(1)}，高于上限${b[k].max.toFixed(1)}`,
          );
      }
      if (!diagnostics.length)
        diagnostics.push(
          "当前食物营养比例、固定重量与整数步长未能同时满足各项范围；请尝试更换食物、放宽范围或减小步长。",
        );
    }
    return {
      variant,
      rows: output,
      totals: totals(output),
      issues,
      diagnostics,
      warnings: !sodiumEnabled(t)
        ? [
            totals(output).unknown.includes("sodium")
              ? "钠数据不完整，未纳入配餐约束，不能判断钠是否超标。"
              : "钠仅作记录，未纳入配餐约束。",
          ]
        : [],
      valid: !issues.length,
      relaxed,
      elapsed: Date.now() - start,
      note: "返回已核验的可行结果；每次求解限时1.8秒，不保证在时限内证明全局最优。",
    };
  }
  const defaultTarget = () => ({
    id: "default",
    name: "我的减脂目标",
    kcal: 1700,
    protein: 130,
    fat: 50,
    carbs: 182.5,
    autoCarbs: true,
    enforceSodium: false,
    sodium: 2000,
    energyTolerance: 5,
    fatTolerance: 10,
    carbTolerance: 20,
  });
  const initialState = () => ({
    version: 1,
    foods: [],
    builtinFoodsSeen: [],
    profiles: [defaultTarget()],
    activeProfile: "default",
    meals: ["全天"],
    templates: [],
    days: {},
  });
  function validateState(s) {
    if (
      !s ||
      s.version !== 1 ||
      !Array.isArray(s.foods) ||
      !Array.isArray(s.profiles) ||
      !Array.isArray(s.templates) ||
      !s.days ||
      typeof s.days !== "object" ||
      Array.isArray(s.days)
    )
      throw Error("备份结构或版本不受支持");
    if (
      s.builtinFoodsSeen !== undefined &&
      (!Array.isArray(s.builtinFoodsSeen) ||
        s.builtinFoodsSeen.some((id) => typeof id !== "string" || !id) ||
        new Set(s.builtinFoodsSeen).size !== s.builtinFoodsSeen.length)
    )
      throw Error("自带食物的初始化记录无效");
    if (
      !Array.isArray(s.meals) ||
      !s.meals.length ||
      s.meals.length > 8 ||
      new Set(s.meals).size !== s.meals.length ||
      s.meals.some((m) => typeof m !== "string" || !m.trim())
    )
      throw Error("餐次须为1–8个不重复名称");
    const unique = (a) => {
      if (
        a.some((x) => !x || typeof x.id !== "string" || !x.id) ||
        new Set(a.map((x) => x.id)).size !== a.length
      )
        throw Error("备份含无效或重复编号");
    };
    unique(s.foods);
    unique(s.profiles);
    unique(s.templates);
    s.foods.forEach(validateFood);
    s.profiles.forEach((t) => {
      targetBounds(t);
      if (typeof t.name !== "string" || !t.name.trim())
        throw Error("目标方案名称无效");
    });
    if (!s.profiles.some((t) => t.id === s.activeProfile))
      throw Error("当前目标方案不存在");
    const checkMeals = (ms) => {
      if (
        !Array.isArray(ms) ||
        !ms.length ||
        ms.length > 8 ||
        new Set(ms).size !== ms.length ||
        ms.some((m) => typeof m !== "string" || !m.trim())
      )
        throw Error("餐次须为1–8个不重复名称");
    };
    const checkRows = (rs, ms) => {
      if (!Array.isArray(rs) || rs.length > 60) throw Error("饮食条目格式无效");
      for (const r of rs) {
        validateFood(r.food);
        if (
          !nonneg(r.grams) ||
          r.grams > 10000 ||
          !nonneg(r.min) ||
          !nonneg(r.max) ||
          r.max < r.min ||
          r.max > 10000 ||
          ![1, 5, 10].includes(r.step) ||
          typeof r.fixed !== "boolean" ||
          !ms.includes(r.meal) ||
          typeof r.id !== "string"
        )
          throw Error("饮食条目无效");
      }
      unique(rs);
    };
    for (const [key, d] of Object.entries(s.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !d)
        throw Error("日期记录格式无效");
      checkMeals(d.meals);
      checkRows(d.plan, d.meals);
      checkRows(d.actual, d.meals);
      targetBounds(d.target);
    }
    for (const t of s.templates) {
      if (typeof t.name !== "string" || !t.name.trim())
        throw Error("套餐信息不完整");
      checkMeals(t.meals);
      checkRows(t.rows, t.meals);
      targetBounds(t.target);
    }
    return s;
  }
  const api = {
    keys,
    labels,
    clone,
    kjToKcal,
    sodiumEnabled,
    validateFood,
    mergeFoodPack,
    installBuiltinFoods,
    factor,
    totals,
    targetBounds,
    validateRows,
    violations,
    scaleTargetCalories,
    buildModel,
    solve,
    defaultTarget,
    initialState,
    validateState,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MealCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
