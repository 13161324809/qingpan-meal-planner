(function () {
  "use strict";
  const C = MealCore,
    $ = (s) => document.querySelector(s),
    esc = (x) =>
      String(x ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  const uid = () =>
    globalThis.crypto?.randomUUID?.() ||
    Date.now().toString(36) + Math.random().toString(36).slice(2);
  const localDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const KEY = "qingpan.v1",
    categories = ["肉类", "鱼类", "主食", "蔬菜", "蛋奶", "饮品", "其他"];
  let state,
    storageError = "",
    rawBackup = "",
    date = localDate(),
    page = "today",
    results = [],
    variant = 0,
    busy = false,
    search = "",
    category = "全部",
    editingTemplate = null,
    nameAction = null;
  try {
    rawBackup = localStorage.getItem(KEY) || "";
    state = rawBackup
      ? C.validateState(JSON.parse(rawBackup))
      : C.initialState();
  } catch (e) {
    state = C.initialState();
    storageError =
      "本地数据读取失败，已停止自动覆盖。请导出原始数据，或导入有效备份恢复。";
  }
  const profile = () =>
    state.profiles.find((t) => t.id === state.activeProfile);
  function day() {
    if (!state.days[date])
      state.days[date] = {
        meals: C.clone(state.meals),
        target: C.clone(profile()),
        plan: [],
        actual: [],
      };
    return state.days[date];
  }
  function persist() {
    if (storageError && rawBackup) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      storageError =
        "浏览器未能保存数据（可能存储已满或被禁用）。当前修改仅在内存中，请立即导出备份。";
      toast(storageError);
    }
  }
  let toastTimer;
  function toast(s) {
    $("#toast").textContent = s;
    $("#toast").style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("#toast").style.display = "none"), 4200);
  }
  function guarded(fn) {
    try {
      fn();
    } catch (e) {
      toast(e.message);
    }
  }
  const fmt = (n) =>
    Number(n).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
  const opts = (a, val) =>
    a
      .map(
        (x) =>
          `<option value="${esc(x)}" ${x === val ? "selected" : ""}>${esc(x)}</option>`,
      )
      .join("");
  const nav = [
    ["today", "◫", "今日配餐"],
    ["foods", "▤", "食物库"],
    ["templates", "▧", "我的套餐"],
    ["records", "◷", "饮食记录"],
    ["settings", "⚙", "个人设置"],
  ];
  function route() {
    const p = location.hash.slice(1);
    page = nav.some((x) => x[0] === p) ? p : "today";
    search = "";
    category = "全部";
    render();
  }
  function heading(title, sub, extra = "") {
    return `<div class="heading"><div><span class="eyebrow">YOUR EVERYDAY, WELL BALANCED</span><h1>${title}</h1><p>${sub}</p></div>${extra}</div>`;
  }
  function empty(title, sub, button = "") {
    return `<div class="empty"><span class="empty-symbol">◌</span><strong>${title}</strong><p>${sub}</p>${button}</div>`;
  }
  function nutritionLine(rows) {
    const s = C.totals(rows);
    return C.keys
      .map(
        (k) =>
          `${C.labels[k]} ${s.unknown.includes(k) ? "未知" : fmt(s[k])}${k === "kcal" ? " kcal" : k === "sodium" ? " mg" : "g"}`,
      )
      .join(" · ");
  }
  function summary(rows, t) {
    const s = C.totals(rows),
      b = C.targetBounds(t);
    return `<section class="panel stats"><span class="summary-title">全天营养 · ${page === "records" ? "实际摄入" : "计划摄入"}</span><div class="energy-big mono">${s.unknown.includes("kcal") ? "—" : fmt(s.kcal)} <small>kcal</small></div><div class="goal-caption">每日目标 ${fmt(t.kcal)} kcal · ${s.unknown.includes("kcal") ? "数据不完整" : (s.kcal > t.kcal ? "高于目标 " : "距目标 ") + fmt(Math.abs(t.kcal - s.kcal)) + " kcal"}</div><div class="meter"><span style="width:${Math.min(100, (s.kcal / t.kcal) * 100)}%"></span></div><hr>${C.keys
      .slice(1)
      .map((k) => {
        const val = k === "sodium" ? t.sodium : b[k].target;
        return `<div class="macro"><span>${C.labels[k]}${k === "sodium" ? "上限" : ""}</span><strong class="mono">${s.unknown.includes(k) ? "未知" : fmt(s[k])}<small> / ${fmt(val)} ${k === "sodium" ? "mg" : "g"}</small></strong></div><div class="meter"><span style="width:${Math.min(100, (s[k] / Math.max(val, 1)) * 100)}%;background:${k === "sodium" && s[k] > val ? "#be7c50" : k === "protein" ? "#71956a" : k === "fat" ? "#d4aa6d" : "#9da88a"}"></span></div>`;
      })
      .join(
        "",
      )}<hr><div class="macro-caption">允许热量偏差 ±${t.energyTolerance}% · 脂肪 ±${t.fatTolerance}g · 碳水 ±${t.carbTolerance}g<br>蛋白质以目标为下限。营养值按食物标签核算。</div><button class="text-button" data-action="go-settings">调整目标 ↗</button></section>`;
  }
  function issuesBox(rows, t) {
    if (!rows.length) return "";
    const issues = C.violations(rows, t);
    const diagnostics =
      page === "today" ? results[variant]?.diagnostics || [] : [];
    return issues.length
      ? `<div class="notice warn"><strong>尚未满足全部营养约束</strong><ul>${issues.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>${diagnostics.length ? `<strong>约束检查</strong><ul>${diagnostics.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`
      : `<div class="notice">✓ 按当前录入数据核算，全部营养约束已满足。</div>`;
  }
  function filteredFoods() {
    return state.foods.filter(
      (f) =>
        (category === "全部" || f.category === category) &&
        `${f.name} ${f.brand} ${f.flavor}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  }
  function filters() {
    return `<div class="toolbar"><input id="search" aria-label="搜索食物" placeholder="搜索食物、品牌或口味" value="${esc(search)}"><button data-action="new-food">＋ 新增食物</button>${page === "foods" ? '<button data-action="import">导入食物包</button><button data-action="export-foods">导出食物库</button>' : ""}</div><div class="chip-row">${["全部", ...categories].map((c) => `<button class="chip ${c === category ? "active" : ""}" data-action="filter" data-value="${c}">${c}</button>`).join("")}</div>`;
  }
  function picker() {
    return (
      filteredFoods()
        .map(
          (f) =>
            `<div class="pick-item"><div><div class="food-name">${esc(f.name)} <small>${esc(f.brand)}</small></div><div class="food-meta">${f.kcal === null ? "能量未知" : fmt(f.kcal) + " kcal /100g营养标示"} · ${esc(f.weightMode)}${f.edibleRatio !== 1 ? " · 可食 " + fmt(f.edibleRatio * 100) + "%" : ""}</div></div><button data-action="add-food" data-id="${esc(f.id)}">＋ 选用</button></div>`,
        )
        .join("") ||
      empty(
        "还没有找到食物",
        state.foods.length
          ? "换个关键词或分类试试。"
          : "先录入包装上的营养值，建立你自己的食物库。",
        '<button class="primary" data-action="new-food">录入第一种食物</button>',
      )
    );
  }
  function rowsView(rows, actual = false) {
    const d = day();
    return d.meals
      .map((m) => {
        const rs = rows.filter((r) => r.meal === m);
        return `<div class="meal-head"><strong>${esc(m)} <small> / ${rs.length} 种食物</small></strong><small>${fmt(C.totals(rs).kcal)} kcal${C.totals(rs).unknown.length ? " · 数据不全" : ""}</small></div>${rs.map((r) => `<div class="row-card"><div><div class="food-name">${esc(r.food.name)}</div><div class="food-meta">${esc(r.food.weightMode)}${r.food.edibleRatio !== 1 ? " · 可食率 " + fmt(r.food.edibleRatio * 100) + "%" : ""}</div>${r.food.unitGrams ? `<div class="row-unit">≈ ${fmt(r.grams / r.food.unitGrams)} 个／份 <button class="text-button" data-action="unit" data-id="${esc(r.id)}" data-actual="${actual}">按个输入</button></div>` : ""}</div><select aria-label="${esc(r.food.name)}餐次" data-row="${esc(r.id)}" data-field="meal" data-actual="${actual}">${opts(d.meals, r.meal)}</select><div class="row-weight"><input aria-label="${esc(r.food.name)}克数" type="number" min="0" max="10000" step="any" value="${r.grams}" data-row="${esc(r.id)}" data-field="grams" data-actual="${actual}"></div><button class="icon-button" aria-label="移除${esc(r.food.name)}" data-action="remove-row" data-id="${esc(r.id)}" data-actual="${actual}">×</button>${actual ? "" : `<div class="constraints"><label>范围 <input aria-label="最小克数" type="number" min="0" max="10000" value="${r.min}" data-row="${esc(r.id)}" data-field="min">—<input aria-label="最大克数" type="number" min="0" max="10000" value="${r.max}" data-row="${esc(r.id)}" data-field="max"> g</label><label>步长 <select data-row="${esc(r.id)}" data-field="step" aria-label="取整单位">${[1, 5, 10].map((x) => `<option ${x === r.step ? "selected" : ""} value="${x}">${x}g</option>`).join("")}</select></label><label class="fixed"><input type="checkbox" ${r.fixed ? "checked" : ""} data-row="${esc(r.id)}" data-field="fixed"> 固定重量</label></div>`}</div>`).join("")}${rs.length ? `<div class="nutrition-line">${nutritionLine(rs)}</div>` : '<p class="section-note">这一餐还未添加食物</p>'}`;
      })
      .join("");
  }
  function today() {
    const d = day();
    return (
      heading(
        "今天，想吃点什么？",
        "选好喜欢的食物，让每一克都有安排。",
        `<input class="date-input" aria-label="计划日期" type="date" id="date" value="${date}">`,
      ) +
      `<div class="layout"><div>${!state.foods.length ? '<div class="notice onboard"><span>↗</span><div><strong>从你的第一张营养标签开始</strong><small>录入食物 → 设置目标 → 选择食物 → 自动计算克数</small></div></div>' : ""}<section class="panel"><div class="panel-title"><h2><span class="step-dot">1</span>选择今天的食物</h2><small>${state.foods.length} 种已录入</small></div>${filters()}<div class="food-picker" id="picker">${picker()}</div></section><section class="panel"><div class="panel-title"><h2><span class="step-dot">2</span>安排餐次与份量</h2><button class="text-button" data-action="go-settings">${d.meals.length} 餐 · 自定义 ↗</button></div><p class="section-note">每条食物可单独分餐、限制范围或锁定重量。克数按所录称重口径计算。</p>${d.plan.length ? rowsView(d.plan) : empty("把想吃的食物放进来", "点击上方「选用」添加；同一种食物可以添加到不同餐次。")}<div class="solve-bar"><small>整数约束优化 · 完全在本机计算<br>不使用 AI 猜测营养数据</small><button class="primary" id="solve" data-action="solve" ${busy ? "disabled" : ""}>${busy ? "正在求解…" : "✧ 自动配餐"}</button></div></section>${results.length ? `<section class="panel"><div class="panel-title"><h2><span class="step-dot">3</span>比较配餐方案</h2><small>可手动微调</small></div><div class="result-tabs">${results.map((r, i) => `<button class="${variant === i ? "active" : ""}" data-action="variant" data-index="${i}">方案 ${r.variant}<small>${["热量与蛋白质优先", "控制钠含量优先", "份量均衡优先"][i]}</small></button>`).join("")}</div><div class="notice ${results[variant].valid ? "" : "warn"}">${results[variant].valid ? "✓ 已找到符合约束的配餐。" : "未找到满足全部条件的方案；下方为明确标注差额的参考结果。"}<br><small>三种目标可能得到相同克数。限时求解，不保证已证明全局最优。</small></div>${!results[variant].rows.length ? `<div class="notice error">${results[variant].issues.map(esc).join("<br>")}</div>` : ""}</section>` : ""}${d.plan.length ? issuesBox(d.plan, d.target) + `<div class="actions"><button data-action="save-template">▧ 保存为套餐</button>${editingTemplate ? '<button class="primary" data-action="update-template">保存套餐修改</button>' : ""}<button data-action="copy-actual">记为实际饮食</button><button class="text-button" data-action="clear-plan">清空计划</button></div>` : ""}</div><aside class="sticky">${summary(d.plan, d.target)}<section class="panel right-note"><strong>简单一点，吃得明白。</strong>① 首次使用请核对个人目标。<br>② 烹饪油、调味料也需要录入。<br>③ 已选食物使用营养数据快照，修改食物库后请移除再选用。<br>④ 建议定期导出 JSON 备份。</section></aside></div>`
    );
  }
  function foodTable() {
    const fs = filteredFoods();
    return fs.length
      ? `<table class="library-table"><thead><tr><th>食物 / 称重口径</th><th>热量 kcal</th><th>蛋白质 g</th><th>脂肪 g</th><th>碳水 g</th><th>钠 mg</th><th>操作</th></tr></thead><tbody>${fs.map((f) => `<tr><td><div class="food-name">${esc(f.name)}</div><div class="food-meta">${esc([f.brand, f.flavor, f.category, f.weightMode].filter(Boolean).join(" · "))}<br>可食 ${fmt(f.edibleRatio * 100)}% · 标示按${f.nutritionBasis === "edible" ? "可食部分" : "称重口径"}</div>${f.notes ? `<div class="food-notes">${esc(f.notes)}</div>` : ""}</td>${C.keys.map((k) => `<td>${f[k] === null ? '<span class="badge warn">待补全</span>' : fmt(f[k])}</td>`).join("")}<td><button class="text-button" data-action="edit-food" data-id="${esc(f.id)}">编辑</button><button class="text-button" data-action="delete-food" data-id="${esc(f.id)}">删除</button></td></tr>`).join("")}</tbody></table>`
      : empty(
          "建立自己的食物库",
          "营养数据由你录入，可长期重复使用。",
          '<button class="primary" data-action="new-food">＋ 新增食物</button>',
        );
  }
  function foods() {
    return (
      heading(
        "你的食物，有据可查。",
        "保存真实营养标签，下次选用无需重复录入。",
      ) +
      `<section class="panel">${filters()}<div class="section-note">以下均为每100g营养标示值。实际营养依照称重口径与可食比例换算。</div><div class="table-scroll" id="food-table">${foodTable()}</div></section>`
    );
  }
  function templates() {
    const title = heading(
      "把合适的搭配，留给下次。",
      "保存具体克数、餐次与营养快照。随时加载、修改、复制。",
    );
    if (!state.templates.length)
      return (
        title +
        `<section class="panel">${empty("你的固定套餐，从这里开始", "在今日配餐算好份量后，点击「保存为套餐」。", '<button class="primary" data-action="go-today">去安排一餐</button>')}</section>`
      );
    return (
      title +
      `<div class="card-grid">${state.templates
        .map(
          (t) =>
            `<section class="panel"><div class="panel-title"><span class="badge">${t.meals.length} 餐 · ${t.rows.length} 项</span><small>${esc(t.updatedAt?.slice(0, 10) || "")}</small></div><h2>${esc(t.name)}</h2>${t.meals
              .map(
                (m) =>
                  `<h3>${esc(m)}</h3><p class="nutrition-line">${
                    t.rows
                      .filter((r) => r.meal === m)
                      .map((r) => `${esc(r.food.name)} ${fmt(r.grams)}g`)
                      .join("、") || "—"
                  }</p>`,
              )
              .join(
                "",
              )}<p class="nutrition-line">${nutritionLine(t.rows)}</p><div class="actions"><button class="primary" data-action="apply-template" data-id="${esc(t.id)}">应用到今天</button><button data-action="edit-template" data-id="${esc(t.id)}">修改</button><button class="text-button" data-action="duplicate-template" data-id="${esc(t.id)}">复制</button><button class="text-button" data-action="rename-template" data-id="${esc(t.id)}">重命名</button><button class="text-button" data-action="delete-template" data-id="${esc(t.id)}">删除</button></div></section>`,
        )
        .join("")}</div>`
    );
  }
  function records() {
    const d = day();
    return (
      heading(
        "真实记录，每一天。",
        "计划与实际分开保存；历史营养数据保留当时的标签和目标。",
        `<input class="date-input" aria-label="记录日期" type="date" id="date" value="${date}">`,
      ) +
      `<div class="day-list">${Object.keys(state.days)
        .filter((k) => state.days[k].actual.length || state.days[k].plan.length)
        .sort()
        .reverse()
        .slice(0, 30)
        .map(
          (k) =>
            `<button data-action="select-date" data-value="${esc(k)}" class="${date === k ? "primary" : ""}">${esc(k)}</button>`,
        )
        .join(
          "",
        )}</div><div class="layout"><section class="panel"><div class="panel-title"><h2>${esc(date)} · 实际吃了什么</h2><span class="badge">独立记录</span></div><div class="notice">当前计划 ${fmt(C.totals(d.plan).kcal)} kcal · 实际 ${fmt(C.totals(d.actual).kcal)} kcal。复制后可单独修改实际克数。</div>${d.actual.length ? rowsView(d.actual, true) : empty("还没有实际饮食记录", "把当日计划复制过来，再按真实食用量调整。")}${issuesBox(d.actual, d.target)}<div class="actions"><button class="primary" data-action="copy-actual">从当日计划复制</button><button data-action="go-today">编辑当日计划</button><button class="text-button" data-action="clear-actual">清空实际记录</button></div></section><aside class="sticky">${summary(d.actual, d.target)}</aside></div>`
    );
  }
  function settings() {
    const t = profile();
    return (
      heading(
        "照顾自己，从合适的目标开始。",
        "目标、餐次和数据都由你掌握。设置仅由你确认保存。",
      ) +
      `<div class="settings-grid"><section class="panel"><h2>营养目标方案</h2><div class="profile-toolbar"><select id="profile" aria-label="目标方案">${state.profiles.map((p) => `<option value="${esc(p.id)}" ${p.id === state.activeProfile ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select><button data-action="new-profile">＋ 新方案</button><button class="text-button" data-action="delete-profile">删除</button></div><form id="target-form"><div class="form-grid"><label>方案名称<input name="name" required maxlength="80" value="${esc(t.name)}"></label><label>每日热量 kcal<input type="number" name="kcal" required min="1" step="any" value="${t.kcal}"></label><label>蛋白质目标 g（下限）<input type="number" name="protein" min="0" step="any" required value="${t.protein}"></label><label>脂肪目标 g<input type="number" name="fat" min="0" step="any" required value="${t.fat}"></label><label class="checkbox-label"><input type="checkbox" name="autoCarbs" ${t.autoCarbs ? "checked" : ""}>按 4/9/4 系数自动计算剩余碳水目标</label><label>碳水目标 g<input type="number" name="carbs" min="0" step="any" required value="${t.autoCarbs ? C.targetBounds(t).carbs.target : t.carbs}" ${t.autoCarbs ? "readonly" : ""}></label><label>每日钠上限 mg<input type="number" name="sodium" min="0" step="any" required value="${t.sodium}"></label><div class="form-section">允许范围 <small>自动配餐必须满足这些范围；无解时显示差额参考结果。</small></div><label>热量允许偏差 ± %<input type="number" name="energyTolerance" min="0" max="100" step="any" required value="${t.energyTolerance}"></label><label>脂肪允许偏差 ± g<input type="number" name="fatTolerance" min="0" step="any" required value="${t.fatTolerance}"></label><label>碳水允许偏差 ± g<input type="number" name="carbTolerance" min="0" step="any" required value="${t.carbTolerance}"></label></div><div class="settings-actions"><button type="submit" class="primary">保存并应用到 ${esc(date)}</button></div><p class="hint" style="margin-top:12px">1700kcal 等初始数值只是可修改的起始设置，并非个人营养建议。标签热量直接用于求解，不强制等于三大营养素的4/9/4折算热量。</p></form></section><div><section class="panel"><h2>自定义餐次</h2><form id="meals-form"><label>餐次名称（每行一餐，最多8餐）<textarea name="meals" rows="4" required>${esc(day().meals.join("\n"))}</textarea></label><p class="hint">保存后应用于 ${esc(date)} 及今后新建日期。现有条目按原餐次顺序对应；减少的餐次合并至最后一餐。</p><button class="primary" type="submit">保存餐次</button></form></section><section class="panel"><h2>备份与恢复</h2><p class="section-note">食物、目标、套餐与每日记录均保存在当前浏览器。电脑和手机可通过 JSON 手动迁移。</p><div class="actions"><button class="primary" data-action="export">↗ 导出完整 JSON</button><button data-action="import">导入备份</button>${rawBackup && storageError ? '<button data-action="raw-export">导出原始损坏数据</button>' : ""}</div><p class="hint" style="margin-top:15px">导入前会校验结构。导入会替换当前数据，请先导出备份。清理浏览器数据会清除本地记录。</p></section><section class="panel right-note"><strong>关于轻盘</strong>无后端 · 无付费 AI · 无第三方统计<br>优化算法：混合整数线性规划<br>求解器：jsLPSolver 1.0.3 / Unlicense<br>v1.0 · 体重趋势与云同步留待后续版本。</section></div></div>`
    );
  }
  function render() {
    document.title = `${nav.find((n) => n[0] === page)[2]} · 轻盘`;
    $("#nav").innerHTML = nav
      .map(
        ([p, icon, title]) =>
          `<a href="#${p}" class="${p === page ? "active" : ""}" ${p === page ? 'aria-current="page"' : ""}><span>${icon}</span><span>${title}</span></a>`,
      )
      .join("");
    $("#app").innerHTML =
      (storageError
        ? `<div class="notice error">${esc(storageError)} <button data-action="raw-export">导出原始数据</button></div>`
        : "") + { today, foods, templates, records, settings }[page]();
  }
  function openFood(id) {
    const form = $("#food-form");
    form.reset();
    const f = state.foods.find((f) => f.id === id);
    $("#food-dialog-title").textContent = f ? "编辑食物" : "新增食物";
    form.elements.id.value = f?.id || "";
    if (f) {
      for (const k of [
        "name",
        "category",
        "brand",
        "flavor",
        "weightMode",
        "nutritionBasis",
        "unitGrams",
        "price",
        "notes",
        ...C.keys.slice(1),
      ])
        form.elements[k].value = f[k] ?? "";
      form.elements.energy.value = f.kcal ?? "";
      form.elements.ediblePercent.value = f.edibleRatio * 100;
    }
    $("#food-dialog").showModal();
  }
  function naming(title, initial, fn) {
    $("#name-title").textContent = title;
    $("#name-form").elements.name.value = initial;
    nameAction = fn;
    $("#name-dialog").showModal();
  }
  function download(content, name) {
    const url = URL.createObjectURL(
      new Blob([content], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportData() {
    download(JSON.stringify(state, null, 2), `轻盘备份-${localDate()}.json`);
    toast("已导出完整备份");
  }
  function invalidate() {
    results = [];
    variant = 0;
  }
  function applyTemplate(t, edit = false) {
    date = localDate();
    const d = day();
    if (d.plan.length && !confirm("将替换今天的计划，实际记录不变。继续？"))
      return;
    const meals = [...new Set([...t.meals, ...d.actual.map((r) => r.meal)])];
    if (meals.length > 8)
      throw Error("套餐与实际记录合计超过8种餐次，请先统一餐次名称");
    d.plan = C.clone(t.rows);
    d.meals = meals;
    d.target = C.clone(profile());
    editingTemplate = edit ? t.id : null;
    invalidate();
    persist();
    location.hash = "today";
    render();
    toast(edit ? "修改后点击「保存套餐修改」" : "套餐已应用到今天");
  }
  async function calculate() {
    if (busy) return;
    try {
      C.validateRows(day().plan, day().meals);
      C.targetBounds(day().target);
    } catch (e) {
      toast(e.message);
      return;
    }
    busy = true;
    render();
    const input = {
      rows: C.clone(day().plan),
      target: C.clone(day().target),
      meals: C.clone(day().meals),
    };
    const sourceDate = date;
    try {
      let out;
      if (location.protocol !== "file:" && typeof Worker !== "undefined")
        out = await new Promise((resolve, reject) => {
          const w = new Worker("worker.js");
          const timer = setTimeout(() => {
            w.terminate();
            reject(Error("计算超过20秒，请减少食物条目或调整步长后重试"));
          }, 20000);
          w.onmessage = (e) => {
            clearTimeout(timer);
            w.terminate();
            resolve(e.data);
          };
          w.onerror = () => {
            clearTimeout(timer);
            w.terminate();
            reject(Error("计算线程加载失败，请检查静态文件是否齐全"));
          };
          w.postMessage(input);
        });
      else {
        await new Promise((r) => setTimeout(r, 30));
        out = {
          results: ["A", "B", "C"].map((v) =>
            C.solve(input.rows, input.target, input.meals, v, solver),
          ),
        };
      }
      if (out.error) throw Error(out.error);
      // Discard stale computations if user changed date or inputs while worker was running.
      if (
        date !== sourceDate ||
        JSON.stringify(day().plan) !== JSON.stringify(input.rows) ||
        JSON.stringify(day().target) !== JSON.stringify(input.target) ||
        JSON.stringify(day().meals) !== JSON.stringify(input.meals)
      ) {
        toast("输入已改变，请重新配餐");
        return;
      }
      results = out.results;
      variant = 0;
      if (results[0].rows.length) day().plan = C.clone(results[0].rows);
      persist();
      toast(
        results[0].valid
          ? "已计算并核验全部营养约束"
          : "目标存在冲突或未找到可行解，请查看差额提示",
      );
    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
      render();
    }
  }
  const actions = {
    "go-settings": () => (location.hash = "settings"),
    "go-today": () => (location.hash = "today"),
    "new-food": () => openFood(),
    "edit-food": (el) => openFood(el.dataset.id),
    "delete-food": (el) => {
      if (confirm("删除此食物？已保存的套餐和记录仍保留营养快照。")) {
        state.foods = state.foods.filter((f) => f.id !== el.dataset.id);
        persist();
        render();
      }
    },
    filter: (el) => {
      category = el.dataset.value;
      render();
    },
    "add-food": (el) => {
      if (day().plan.length >= 60) throw Error("每次配餐最多60项");
      const f = state.foods.find((f) => f.id === el.dataset.id);
      day().plan.push({
        id: uid(),
        food: C.clone(f),
        meal: day().meals[0],
        grams: 100,
        min: 0,
        max: 500,
        step: 5,
        fixed: false,
      });
      invalidate();
      persist();
      render();
      toast("已添加，可调整餐次和重量范围");
    },
    "remove-row": (el) => {
      const key = el.dataset.actual === "true" ? "actual" : "plan";
      day()[key] = day()[key].filter((r) => r.id !== el.dataset.id);
      if (key === "plan") invalidate();
      persist();
      render();
    },
    unit: (el) => {
      const rs = day()[el.dataset.actual === "true" ? "actual" : "plan"];
      const r = rs.find((r) => r.id === el.dataset.id);
      const count = prompt(
        `每个／份按 ${r.food.unitGrams}g（${r.food.weightMode}）换算。输入数量：`,
        String(r.grams / r.food.unitGrams),
      );
      if (count === null) return;
      const n = Number(count);
      if (
        !count.trim() ||
        !Number.isFinite(n) ||
        n < 0 ||
        n * r.food.unitGrams > 10000
      )
        throw Error("数量无效");
      r.grams = n * r.food.unitGrams;
      if (el.dataset.actual !== "true") invalidate();
      persist();
      render();
    },
    solve: calculate,
    variant: (el) => {
      variant = Number(el.dataset.index);
      if (results[variant].rows.length)
        day().plan = C.clone(results[variant].rows);
      persist();
      render();
    },
    "save-template": () => {
      if (!day().plan.length) throw Error("请先添加食物");
      naming("保存固定套餐", "我的配餐", (name) => {
        state.templates.push({
          id: uid(),
          name,
          rows: C.clone(day().plan),
          meals: C.clone(day().meals),
          target: C.clone(day().target),
          summary: C.totals(day().plan),
          updatedAt: new Date().toISOString(),
        });
      });
    },
    "update-template": () => {
      const t = state.templates.find((t) => t.id === editingTemplate);
      if (!t) throw Error("套餐已不存在");
      Object.assign(t, {
        rows: C.clone(day().plan),
        meals: C.clone(day().meals),
        target: C.clone(day().target),
        summary: C.totals(day().plan),
        updatedAt: new Date().toISOString(),
      });
      persist();
      toast("套餐修改已保存");
    },
    "apply-template": (el) =>
      applyTemplate(state.templates.find((t) => t.id === el.dataset.id)),
    "edit-template": (el) =>
      applyTemplate(
        state.templates.find((t) => t.id === el.dataset.id),
        true,
      ),
    "rename-template": (el) => {
      const t = state.templates.find((t) => t.id === el.dataset.id);
      naming("重命名套餐", t.name, (name) => {
        t.name = name;
        t.updatedAt = new Date().toISOString();
      });
    },
    "duplicate-template": (el) => {
      const t = C.clone(state.templates.find((t) => t.id === el.dataset.id));
      t.id = uid();
      t.name += "（副本）";
      t.updatedAt = new Date().toISOString();
      state.templates.push(t);
      persist();
      render();
      toast("已复制套餐");
    },
    "delete-template": (el) => {
      if (confirm("删除这个套餐？")) {
        state.templates = state.templates.filter((t) => t.id !== el.dataset.id);
        persist();
        render();
      }
    },
    "copy-actual": () => {
      const d = day();
      if (!d.plan.length) throw Error("当日计划为空，请先添加食物");
      if (d.actual.length && !confirm("用当日计划替换实际记录？")) return;
      d.actual = C.clone(d.plan);
      persist();
      render();
      toast("已复制为实际饮食，可单独修改克数");
    },
    "clear-plan": () => {
      if (confirm("清空当前日期的计划？")) {
        day().plan = [];
        editingTemplate = null;
        invalidate();
        persist();
        render();
      }
    },
    "clear-actual": () => {
      if (confirm("清空当前日期的实际记录？")) {
        day().actual = [];
        persist();
        render();
      }
    },
    "select-date": (el) => {
      date = el.dataset.value;
      editingTemplate = null;
      invalidate();
      render();
    },
    "new-profile": () =>
      naming("新增目标方案", "自定义模式", (name) => {
        const t = C.clone(profile());
        t.id = uid();
        t.name = name;
        state.profiles.push(t);
        state.activeProfile = t.id;
      }),
    "delete-profile": () => {
      if (state.profiles.length === 1) throw Error("至少保留一个目标方案");
      if (confirm("删除当前目标方案？历史目标快照仍保留。")) {
        state.profiles = state.profiles.filter(
          (t) => t.id !== state.activeProfile,
        );
        state.activeProfile = state.profiles[0].id;
        persist();
        render();
      }
    },
    "export-foods": () =>
      download(
        JSON.stringify(
          { type: "qingpan-foods", version: 1, foods: state.foods },
          null,
          2,
        ),
        `轻盘食物库-${localDate()}.json`,
      ),
    export: exportData,
    import: () => $("#import-file").click(),
    "raw-export": () =>
      download(
        rawBackup || JSON.stringify(state, null, 2),
        `轻盘原始数据-${localDate()}.json`,
      ),
  };
  document.addEventListener("click", (e) => {
    const close = e.target.closest("[data-close]");
    if (close) {
      document.getElementById(close.dataset.close).close();
      return;
    }
    const el = e.target.closest("[data-action]");
    if (el) guarded(() => actions[el.dataset.action]?.(el));
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "search") {
      search = e.target.value;
      if (page === "today") $("#picker").innerHTML = picker();
      if (page === "foods") $("#food-table").innerHTML = foodTable();
    }
    if (e.target.closest("#target-form")) {
      const f = $("#target-form");
      f.elements.carbs.readOnly = f.elements.autoCarbs.checked;
      if (f.elements.autoCarbs.checked) {
        const n =
          (Number(f.elements.kcal.value) -
            Number(f.elements.protein.value) * 4 -
            Number(f.elements.fat.value) * 9) /
          4;
        f.elements.carbs.value = n >= 0 ? n : "";
      }
    }
  });
  document.addEventListener("change", (e) =>
    guarded(() => {
      const el = e.target;
      if (el.id === "date") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(el.value)) return;
        date = el.value;
        editingTemplate = null;
        invalidate();
        render();
      } else if (el.id === "profile") {
        state.activeProfile = el.value;
        persist();
        render();
        toast("已切换方案，点击保存后应用到当前日期");
      } else if (el.dataset.row) {
        const actual = el.dataset.actual === "true";
        const r = day()[actual ? "actual" : "plan"].find(
          (r) => r.id === el.dataset.row,
        );
        const k = el.dataset.field;
        const v =
          k === "fixed"
            ? el.checked
            : k === "meal"
              ? el.value
              : Number(el.value);
        if (
          !["fixed", "meal"].includes(k) &&
          (!el.value.trim() || !Number.isFinite(v) || v < 0 || v > 10000)
        ) {
          render();
          throw Error("请输入0–10000范围内的有效重量");
        }
        if ((k === "min" && v > r.max) || (k === "max" && v < r.min)) {
          render();
          throw Error("最小重量不能大于最大重量");
        }
        r[k] = v;
        if (!actual) invalidate();
        persist();
        render();
      }
    }),
  );
  $("#food-form").addEventListener("submit", (e) => {
    e.preventDefault();
    guarded(() => {
      const form = e.target,
        fd = new FormData(form);
      const text = (k) => String(fd.get(k) || "").trim(),
        num = (k) => (text(k) === "" ? null : Number(text(k)));
      const f = {
        id: text("id") || uid(),
        name: text("name"),
        category: text("category"),
        brand: text("brand"),
        flavor: text("flavor"),
        kcal:
          num("energy") === null
            ? null
            : text("energyUnit") === "kj"
              ? C.kjToKcal(num("energy"))
              : num("energy"),
        protein: num("protein"),
        fat: num("fat"),
        carbs: num("carbs"),
        sodium: num("sodium"),
        weightMode: text("weightMode"),
        edibleRatio: num("ediblePercent") / 100,
        nutritionBasis: text("nutritionBasis"),
        unitGrams: num("unitGrams"),
        price: num("price"),
        notes: text("notes"),
      };
      C.validateFood(f);
      const i = state.foods.findIndex((x) => x.id === f.id);
      if (i < 0) state.foods.push(f);
      else state.foods[i] = f;
      persist();
      $("#food-dialog").close();
      render();
      toast("食物已保存；已有条目保留原始快照");
    });
  });
  $("#name-form").addEventListener("submit", (e) => {
    e.preventDefault();
    guarded(() => {
      const name = e.target.elements.name.value.trim();
      if (!name) throw Error("请输入名称");
      nameAction(name);
      persist();
      $("#name-dialog").close();
      render();
      toast("已保存");
    });
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id === "target-form") {
      e.preventDefault();
      guarded(() => {
        const fd = new FormData(e.target),
          t = { ...profile() };
        for (const k of [
          "kcal",
          "protein",
          "fat",
          "carbs",
          "sodium",
          "energyTolerance",
          "fatTolerance",
          "carbTolerance",
        ])
          t[k] = Number(fd.get(k));
        t.name = String(fd.get("name")).trim();
        t.autoCarbs = fd.has("autoCarbs");
        if (!t.name) throw Error("方案名称不能为空");
        C.targetBounds(t);
        Object.assign(profile(), t);
        day().target = C.clone(t);
        invalidate();
        persist();
        render();
        toast("目标已保存并应用到当前日期");
      });
    } else if (e.target.id === "meals-form") {
      e.preventDefault();
      guarded(() => {
        const meals = new FormData(e.target)
          .get("meals")
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean);
        if (
          !meals.length ||
          meals.length > 8 ||
          new Set(meals).size !== meals.length
        )
          throw Error("请输入1–8个不重复餐次名称");
        const d = day(),
          old = d.meals;
        for (const r of [...d.plan, ...d.actual])
          r.meal =
            meals[Math.min(Math.max(0, old.indexOf(r.meal)), meals.length - 1)];
        d.meals = meals;
        state.meals = C.clone(meals);
        invalidate();
        persist();
        render();
        toast("餐次已保存");
      });
    }
  });
  $("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw Error("备份文件不能超过10MB");
      const data = JSON.parse(await file.text());
      if (data.type === "qingpan-foods") {
        if (storageError && rawBackup)
          throw Error("当前本地数据损坏，请先恢复完整备份，再合并食物");
        const merged = C.mergeFoodPack(state, data);
        if (
          !confirm(
            `食物包校验通过：新增${merged.added}种，跳过${merged.skipped}种重复食物。现有食物、目标、套餐和记录保持原样，是否导入？`,
          )
        )
          return;
        state = merged.state;
        persist();
        render();
        toast(`已导入${merged.added}种食物，跳过${merged.skipped}种重复条目`);
        return;
      }
      const next = C.validateState(data);
      if (
        !confirm(
          `校验通过：${next.foods.length}种食物、${next.templates.length}个套餐。将替换当前全部数据，是否继续？`,
        )
      )
        return;
      state = C.clone(next);
      storageError = "";
      rawBackup = "";
      editingTemplate = null;
      invalidate();
      persist();
      render();
      toast("备份已恢复");
    } catch (err) {
      toast("导入失败：" + err.message);
    } finally {
      e.target.value = "";
    }
  });
  $("#backup-top").addEventListener("click", exportData);
  window.addEventListener("hashchange", route);
  route();
})();
