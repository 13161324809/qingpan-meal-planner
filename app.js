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
    categories = ["肉类", "鱼类", "主食", "蔬菜", "蛋奶", "饮品", "水果", "坚果", "调味品", "油脂", "其他"];
  const builtinFoods = globalThis.QingpanBuiltinFoods || null;
  let cloudConfig = null, cloudToken = "", cloudStore = null, cloudConnected = false, cloudDirty = false, cloudWorking = false, cloudMessage = "";
  let fileMode = false, fileStore = null, fileDirty = false, fileBusy = 0, fileBinding = false, fileMessage = "";
  try {
    const saved = localStorage.getItem("qingpan.githubConfig");
    if (saved && globalThis.GithubJsonStorage) cloudConfig = GithubJsonStorage.config(JSON.parse(saved));
    cloudToken = sessionStorage.getItem("qingpan.githubToken") || "";
    fileMode = !cloudConfig && localStorage.getItem("qingpan.fileMode") === "1";
  } catch { cloudMessage = "同步配置无法读取，可在个人设置重新填写。"; }
  let state,
    storageError = "",
    rawBackup = "",
    date = localDate(),
    weightDate = localDate(),
    page = "today",
    results = [],
    variant = 0,
    busy = false,
    solveJob = null,
    solveProgress = "",
    search = "",
    category = "全部",
    editingTemplate = null,
    nameAction = null;
  let calendarDay = localDate(), followsToday = true, nextRouteDate = null;
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
    if (fileMode) {
      fileDirty = true;
      if (!fileStore) { updateFileStatus(); return "file-unbound"; }
      queueFileSave(); return "file-pending";
    }
    if (cloudConfig) { cloudDirty = true; if (cloudConnected) cloudMessage = ""; updateCloudStatus(); return "cloud-pending"; }
    if (storageError && rawBackup) return false;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return "local";
    } catch (e) {
      storageError =
        "浏览器未能保存数据（可能存储已满或被禁用）。当前修改仅在内存中，请立即导出备份。";
      toast(storageError);
      return false;
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
    ["weights", "↘", "体重记录"],
    ["settings", "⚙", "个人设置"],
  ];
  function route() {
    const p = location.hash.slice(1);
    page = nav.some((x) => x[0] === p) ? p : "today";
    if (["today","records"].includes(page)) {
      const nextDate = nextRouteDate || localDate();
      if (date !== nextDate) { editingTemplate = null; invalidate(); }
      date = nextDate;
      followsToday = date === localDate();
      calendarDay = localDate();
      nextRouteDate = null;
    }
    search = "";
    category = "全部";
    render();
  }
  function selectDiaryDate(value) {
    if (!C.validRecordDate(value)) throw Error("请选择有效的饮食记录日期");
    date = value; followsToday = value === localDate();
    editingTemplate = null; invalidate();
  }
  function refreshCalendarDate() {
    const today = localDate();
    if (today === calendarDay) return false;
    const previous = calendarDay; calendarDay = today;
    if (weightDate === previous) weightDate = today;
    if (!followsToday) return false;
    date = today; editingTemplate = null;
    solveJob?.cancel(); invalidate(); render();
    return true;
  }
  function diaryDateNotice() {
    const today = date === localDate();
    return `<div class="notice ${today ? '' : 'warn'} diary-date-notice">当前${page === 'records' ? '查看/记录' : '配餐'}日期：<strong>${esc(date)}（${today ? '今天' : '历史或指定日期'}）</strong>。${fileMode ? '修改会自动写入绑定的JSON文件，请留意保存状态。' : cloudConfig ? '修改后需保存到GitHub。' : '目前保存在浏览器内，请绑定JSON文件以长期保存。'}${today ? '' : '补记会保存到这个日期。'} <button type="button" data-action="diary-today">回到今天</button></div>`;
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
      .join(" · ") + " · " + fiberLine(rows) + " · " + costLine(rows);
  }
  function fiberLine(rows) {
    const value = C.fiberTotals(rows,state.foods);
    return "膳食纤维 " + fmt(value.grams) + "g" + (value.estimated ? "（部分未提供，暂按0）" : "");
  }
  function foodFiber(food) {
    const value = C.fiberTotals([{food,grams:100}],state.foods);
    return fmt(value.grams) + (value.estimated ? "（部分未提供，暂按0）" : "");
  }
  function purchaseText(f) {
    if (f.isComposite) return "每份 · " + costLine([{food:f, grams:f.unitGrams}]);
    if (f.price !== null) return "直接单价 ¥" + f.price + "/100g";
    const p = f.purchase;
    if (!p) return f.isComposite ? "费用按配方原料价格合计" : "价格未录入";
    return "采购 ¥" + p.amount + " / " + p.quantity + ({g:"g", ml:"ml", count:"枚"}[p.unit]) +
      (p.yield !== null && p.yield !== 1 ? " · 成本净重 " + fmt(p.yield * 100) + "%" : "") +
      (p.unit === "ml" ? (p.density ? " · " + p.density + "g/ml" : " · 换算密度待补") : "") +
      (p.unit === "g" && p.yield === null ? " · 成本净重比例待补" : "") + (p.estimated ? " · 估算" : "");
  }
  function costLine(rows) {
    const cost = C.costs(rows, state.foods);
    return `${cost.complete ? "预计费用" : "已知费用"} ¥${cost.known.toFixed(2)}${cost.unknown.length ? "（待补价格/换算：" + cost.unknown.join("、") + "）" : ""}${cost.estimated.length ? "（含估算系数）" : ""}`;
  }
  function costSummary(rows) {
    const cost = C.costs(rows, state.foods);
    return `<hr><div class="cost-summary"><strong>${esc(costLine(rows))}</strong><p class="hint">按当前食物库采购价估算${cost.complete ? "" : "，仅合计已有完整价格的数据"}。${cost.estimated.length ? "估算换算：" + esc(cost.estimated.join("、")) + "。" : ""}组合套餐按配方用量合计费用。</p></div>`;
  }
  function summary(rows, t) {
    const s = C.totals(rows),
      b = C.targetBounds(t);
    return `<section class="panel stats"><span class="summary-title">全天营养 · ${page === "records" ? "实际摄入" : "计划摄入"}</span><div class="energy-big mono">${s.unknown.includes("kcal") ? "—" : fmt(s.kcal)} <small>kcal</small></div><div class="goal-caption">每日目标 ${fmt(t.kcal)} kcal · ${s.unknown.includes("kcal") ? "数据不完整" : (s.kcal > t.kcal ? "高于目标 " : "距目标 ") + fmt(Math.abs(t.kcal - s.kcal)) + " kcal"}</div><div class="meter"><span style="width:${Math.min(100, (s.kcal / t.kcal) * 100)}%"></span></div><hr>${C.keys
      .slice(1)
      .map((k) => {
        if (k === "sodium") {
          const unknown = s.unknown.includes(k),
            strict = C.sodiumEnabled(t);
          return `<div class="macro"><span>钠${strict ? "上限" : "（仅记录）"}</span><strong class="mono">${unknown ? "数据不完整" : fmt(s.sodium) + " mg"}${strict ? `<small> / ${fmt(t.sodium)} mg</small>` : ""}</strong></div>${unknown ? `<div class="macro-caption">已知部分 ${fmt(s.sodium)} mg；不代表全天总量。</div>` : ""}<div class="macro-caption">${strict ? "已开启严格限制" : "未纳入配餐约束"}</div>`;
        }
        const val = k === "sodium" ? t.sodium : b[k].target;
        return `<div class="macro"><span>${C.labels[k]}${k === "sodium" ? "上限" : ""}</span><strong class="mono">${s.unknown.includes(k) ? "未知" : fmt(s[k])}<small> / ${fmt(val)} ${k === "sodium" ? "mg" : "g"}</small></strong></div><div class="meter"><span style="width:${Math.min(100, (s[k] / Math.max(val, 1)) * 100)}%;background:${k === "sodium" && s[k] > val ? "#be7c50" : k === "protein" ? "#71956a" : k === "fat" ? "#d4aa6d" : "#9da88a"}"></span></div>`;
      })
      .join(
        "",
      )}<hr><div class="macro-caption">允许热量偏差 ±${t.energyTolerance}% · 脂肪 ±${t.fatTolerance}g · 碳水 ±${t.carbTolerance}g<br>蛋白质以目标为下限。营养值按食物标签核算。</div><button class="text-button" data-action="go-settings">调整目标 ↗</button><hr><div class="macro fiber-summary"><span>膳食纤维</span><strong>${esc(fiberLine(rows))}</strong></div>${costSummary(rows)}</section>`;
  }
  function issuesBox(rows, t) {
    if (!rows.length) return "";
    const issues = C.violations(rows, t);
    const diagnostics =
      page === "today" ? results[variant]?.diagnostics || [] : [];
    const scope = C.sodiumEnabled(t)
      ? "当前启用的营养约束已满足"
      : "热量、蛋白质、脂肪和碳水约束已满足";
    const sodiumNote = !C.sodiumEnabled(t)
      ? `<div class="notice">${C.totals(rows).unknown.includes("sodium") ? "钠数据不完整，未参与配餐，无法判断是否超标。" : "钠仅作记录，未参与配餐约束。"}</div>`
      : "";
    return (
      (issues.length
        ? `<div class="notice warn"><strong>尚未满足全部营养约束</strong><ul>${issues.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>${diagnostics.length ? `<strong>约束检查</strong><ul>${diagnostics.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`
        : `<div class="notice">✓ 按当前录入数据核算，${scope}。</div>`) +
      sodiumNote
    );
  }
  const sortFields = {default:"默认顺序", kcal:"热量", protein:"蛋白质", price:"费用", fat:"脂肪", carbs:"碳水"};
  function mealSort() {
    const saved = state.mealSort || {};
    return {field:Object.hasOwn(sortFields, saved.field) ? saved.field : "default", direction:saved.direction === "asc" ? "asc" : "desc"};
  }
  function rowSortValue(row, field) {
    if (field === "price") {
      const value = C.costs([row], state.foods);
      return value.complete ? value.known : null;
    }
    const value = C.totals([row]);
    return value.unknown.includes(field) ? null : value[field];
  }
  const mealRowOrder = new Map();
  function sortRows(rows, actual = false, apply = false) {
    const key = date + (actual ? ":actual" : ":plan");
    const byId = new Map(rows.map(row => [row.id,row]));
    let ids = (mealRowOrder.get(key) || []).filter(id => byId.has(id));
    const previous = new Set(ids);
    ids.push(...rows.filter(row => !previous.has(row.id)).map(row => row.id));
    const {field, direction} = mealSort();
    if (apply) ids = field === "default" ? rows.map(row => row.id) : ids.map(id => ({id,value:rowSortValue(byId.get(id),field)})).sort((a,b) => {
        if (a.value === null) return b.value === null ? 0 : 1;
        if (b.value === null) return -1;
        return (a.value-b.value) * (direction === "asc" ? 1 : -1);
      }).map(item => item.id);
    mealRowOrder.set(key,ids);
    return ids.map(id => byId.get(id));
  }
  function mealSortControls(actual = false) {
    const sort = mealSort();
    return '<div class="food-sort"><label>配餐排序<select id="meal-sort-field" aria-label="配餐排序依据">' +
      Object.entries(sortFields).map(([value,label]) => '<option value="'+value+'" '+(value===sort.field?'selected':'')+'>'+label+'</option>').join('') +
      '</select></label><label>顺序<select id="meal-sort-direction" aria-label="配餐排序顺序" '+(sort.field==='default'?'disabled':'')+'><option value="desc" '+(sort.direction==='desc'?'selected':'')+'>从高到低</option><option value="asc" '+(sort.direction==='asc'?'selected':'')+'>从低到高</option></select></label><button type="button" data-action="sort-meal" data-actual="'+actual+'">排序</button><small>按实际用量比较，未知值排最后；点击排序才调整顺序，修改重量不会跳行</small></div>';
  }
  function rowSortCaption(row) {
    const {field} = mealSort();
    if (field === "default") return "";
    const value = rowSortValue(row, field);
    const text = value === null ? "未知（排最后）" : field === "price" ? "¥" + value.toFixed(2) : fmt(value) + (field === "kcal" ? " kcal" : "g");
    return '<div class="food-meta sort-value">本项'+sortFields[field]+'：'+text+'</div>';
  }
  function filteredFoods() {
    return state.foods.filter(f => (category === "全部" || f.category === category) &&
      (f.name+' '+f.brand+' '+f.flavor+' '+(f.barcode || '')).toLowerCase().includes(search.toLowerCase()));
  }
  function foodCategories() {
    return [...new Set([...categories, ...state.foods.map((f) => f.category).filter(Boolean)])];
  }
  function filters() {
    const foodActions =
      page === "foods"
        ? '<button data-action="import">导入食物包</button><button data-action="export-foods">导出食物库</button>' +
          (builtinFoods
            ? '<button data-action="restore-builtin">恢复自带食物</button>'
            : "")
        : "";
    return `<div class="toolbar"><input id="search" aria-label="搜索食物" placeholder="搜索食物、品牌或口味" value="${esc(search)}"><button data-action="new-food">＋ 新增食物</button><button data-action="new-combo">＋ 组合套餐</button>${foodActions}</div><div class="chip-row">${["全部", ...foodCategories()].map((c) => `<button class="chip ${c === category ? "active" : ""}" data-action="filter" data-value="${esc(c)}">${c}</button>`).join("")}</div>`;
  }
  const productId = (id) => id === "photo-20261112-pure-nut-kernels" ? "photo-20261111-nuts" : id;
  function picker() {
    return (
      filteredFoods()
        .filter((f) => !day().plan.some((r) => productId(r.food.id) === productId(f.id)))
        .map(
          (f) =>
            `<div class="pick-item"><div><div class="food-name">${esc(f.name)} <small>${esc(f.brand)}</small></div><div class="food-meta">${f.kcal === null ? "能量未知" : fmt(f.kcal) + " kcal /100g营养标示"} · ${esc(f.weightMode)}</div>${f.isComposite ? `<div class="food-meta combo-cost">${esc(purchaseText(f))}</div>` : ""}</div><button data-action="add-food" data-id="${esc(f.id)}">＋ 选用</button></div>`,
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
  function countControls(r, actual) {
    const n = r.grams / r.food.unitGrams;
    const unit = r.food.isComposite ? "份" : "个";
    return `<div class="count-controls"><button type="button" aria-label="减少一${unit}${esc(r.food.name)}" data-action="count-minus" data-id="${esc(r.id)}" data-actual="${actual}">−</button><input aria-label="${esc(r.food.name)}${unit}数" type="number" min="0" max="${Math.floor(10000 / r.food.unitGrams)}" step="1" value="${n}" data-row="${esc(r.id)}" data-field="count" data-actual="${actual}"><span>${unit}</span><button type="button" aria-label="增加一${unit}${esc(r.food.name)}" data-action="count-plus" data-id="${esc(r.id)}" data-actual="${actual}">＋</button></div><small>${r.food.isComposite ? "每份配方 " + fmt(r.food.unitGrams) + "g" : "每个可食 " + fmt(r.food.unitGrams) + "g（估算，可编辑校准）"}<br>共 ${fmt(r.grams)}g</small>`;
  }
  function countRange(r) {
    if (r.food.isComposite) return '<div class="constraints">整体份数固定，不拆分原料，不参与自动调整</div>';
    const unit = r.food.isComposite ? "份" : "个";
    return `<div class="constraints"><label>数量范围 <input aria-label="最少个数" type="number" min="0" step="1" value="${Math.ceil(r.min / r.food.unitGrams)}" data-row="${esc(r.id)}" data-field="minCount">—<input aria-label="最多个数" type="number" min="0" step="1" value="${Math.floor(r.max / r.food.unitGrams)}" data-row="${esc(r.id)}" data-field="maxCount"> ${unit}</label><span>自动计算按整数${unit}</span><label class="fixed"><input type="checkbox" ${r.fixed ? "checked" : ""} data-row="${esc(r.id)}" data-field="fixed"> 固定数量</label></div>`;
  }
  function changeCount(el, delta) {
    const actual = el.dataset.actual === "true";
    const r = day()[actual ? "actual" : "plan"].find(r => r.id === el.dataset.id);
    if (!r || !C.counted(r.food)) throw Error("按个计量的食物不存在");
    const count = Math.max(0, Math.round(r.grams / r.food.unitGrams) + delta);
    if (count * r.food.unitGrams > 10000) throw Error("数量超出上限");
    r.grams = count * r.food.unitGrams;
    if (!actual) invalidate();
    persist();
    render();
  }
  function rowNutrients(row) {
    const total = C.totals([row]);
    const cost = C.costs([row],state.foods);
    const nutrients = ["kcal","protein","fat","carbs"].map(key => {
      const value = total.unknown.includes(key) ? "未知" : fmt(total[key]) + (key === "kcal" ? " kcal" : "g");
      return `<div data-nutrient="${key}"><dt>${C.labels[key]}</dt><dd>${value}</dd></div>`;
    }).join("");
    const price = (cost.complete ? "" : "已知 ") + (cost.estimated.length ? "≈" : "") + "¥" + cost.known.toFixed(2);
    return `<dl class="row-nutrients" aria-label="本项营养和费用">${nutrients}<div data-nutrient="cost"><dt>费用${cost.complete ? "" : "（未算全）"}</dt><dd>${price}</dd></div></dl>${cost.unknown.length ? `<div class="food-meta">待补价格/换算：${esc(cost.unknown.join("、"))}</div>` : ""}`;
  }
  function rowsView(rows, actual = false) {
    const d = day();
    return ["全天"]
      .map((m) => {
        const rs = sortRows(rows, actual);
        return `<div class="meal-head"><strong>${esc(m)} <small> / ${rs.length} 种食物</small></strong><small>${fmt(C.totals(rs).kcal)} kcal${C.totals(rs).unknown.length ? " · 数据不全" : ""}</small></div>${rs.length ? mealSortControls(actual) : ""}${rs.map((r) => `<div class="row-card all-day"><div><div class="food-name">${esc(r.food.name)}</div><div class="food-meta">${esc(r.food.weightMode)}</div>${rowSortCaption(r)}${rowNutrients(r)}<div class="food-meta">${esc(fiberLine([r]))}</div>${r.food.unitGrams && !C.counted(r.food) ? `<div class="row-unit">≈ ${fmt(r.grams / r.food.unitGrams)} 个／份 <button class="text-button" data-action="unit" data-id="${esc(r.id)}" data-actual="${actual}">按个输入</button></div>` : ""}</div><div class="row-weight">${C.counted(r.food) ? countControls(r, actual) : `<input aria-label="${esc(r.food.name)}克数" type="number" min="0" max="10000" step="any" value="${r.grams}" data-row="${esc(r.id)}" data-field="grams" data-actual="${actual}">`}</div><button class="icon-button" aria-label="移除${esc(r.food.name)}" data-action="remove-row" data-id="${esc(r.id)}" data-actual="${actual}">×</button>${actual ? "" : C.counted(r.food) ? countRange(r) : `<div class="constraints"><label>范围 <input aria-label="最小克数" type="number" min="0" max="10000" value="${r.min}" data-row="${esc(r.id)}" data-field="min">—<input aria-label="最大克数" type="number" min="0" max="10000" value="${r.max}" data-row="${esc(r.id)}" data-field="max"> g</label><label>步长 <select data-row="${esc(r.id)}" data-field="step" aria-label="取整单位">${[1, 5, 10].map((x) => `<option ${x === r.step ? "selected" : ""} value="${x}">${x}g</option>`).join("")}</select></label><label class="fixed"><input type="checkbox" ${r.fixed ? "checked" : ""} data-row="${esc(r.id)}" data-field="fixed"> 固定重量</label></div>`}</div>`).join("")}${rs.length ? `<div class="nutrition-line">${nutritionLine(rs)}</div>` : '<p class="section-note">这一餐还未添加食物</p>'}`;
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
      `${diaryDateNotice()}<div class="layout"><div>${!state.foods.length ? '<div class="notice onboard"><span>↗</span><div><strong>从你的第一张营养标签开始</strong><small>录入食物 → 设置目标 → 选择食物 → 自动计算克数</small></div></div>' : ""}<section class="panel"><div class="panel-title"><h2><span class="step-dot">1</span>选择今天的食物</h2><small>${state.foods.length} 种已录入</small></div>${filters()}<div class="food-picker" id="picker">${picker()}</div></section><section class="panel"><div class="panel-title"><h2><span class="step-dot">2</span>填写目标热量</h2></div><form id="quick-target-form"><label>全天目标热量（kcal）<input id="quick-kcal" type="number" min="1" max="100000" step="any" required value="${d.target.kcal}"></label><p class="hint">无需安排早中晚。蛋白质、脂肪、碳水按当前目标比例随热量调整；需要时可在设置修改比例。</p></form>${d.plan.length ? rowsView(d.plan) : empty("把想吃的食物放进来", "点击上方「选用」添加想吃的食材，再填写全天目标热量。")}<div class="solve-bar"><small>整数约束优化 · 完全在本机计算<br>不使用 AI 猜测营养数据</small><button class="primary" id="solve" data-action="solve" ${busy ? "disabled" : ""}>${busy ? solveProgress || "正在启动后台计算…" : "✧ 自动配餐"}</button>${busy ? '<button type="button" data-action="cancel-solve">取消计算</button>' : ""}</div></section>${results.length ? `<section class="panel"><div class="panel-title"><h2><span class="step-dot">3</span>比较配餐方案</h2><small>可手动微调</small></div><div class="result-tabs">${results.map((r, i) => `<button class="${variant === i ? "active" : ""}" data-action="variant" data-index="${i}">方案 ${r.variant}<small>${["热量与蛋白质优先", C.sodiumEnabled(d.target) ? "控制钠含量优先" : "钠未启用 · 与A相同", "份量均衡优先"][i]}</small></button>`).join("")}</div><div class="notice ${results[variant].valid ? "" : "warn"}">${results[variant].valid ? "✓ 已找到满足当前启用约束的配餐。" : "未找到满足全部条件的方案；下方为明确标注差额的参考结果。"}<br><small>三种目标可能得到相同克数。限时求解，不保证已证明全局最优。</small></div>${!results[variant].rows.length ? `<div class="notice error">${results[variant].issues.map(esc).join("<br>")}</div>` : ""}</section>` : ""}${d.plan.length ? issuesBox(d.plan, d.target) + `<div class="actions"><button data-action="save-template">▧ 保存为套餐</button>${editingTemplate ? '<button class="primary" data-action="update-template">保存套餐修改</button>' : ""}<button data-action="copy-actual">记为 ${esc(date)} 实际饮食</button><button class="text-button" data-action="clear-plan">清空计划</button></div>` : ""}</div><aside class="sticky">${summary(d.plan, d.target)}<section class="panel right-note"><strong>简单一点，吃得明白。</strong>① 首次使用请核对个人目标。<br>② 烹饪油、调味料也需要录入。<br>③ 已选食物使用营养数据快照，修改食物库后请移除再选用。<br>④ 建议定期导出 JSON 备份。</section></aside></div>`
    );
  }
  function foodTable() {
    const fs = filteredFoods();
    return fs.length
      ? `<table class="library-table"><thead><tr><th>食物 / 称重口径</th><th>热量 kcal</th><th>蛋白质 g</th><th>脂肪 g</th><th>碳水 g</th><th>钠 mg</th><th>膳食纤维 g</th><th>操作</th></tr></thead><tbody>${fs.map((f) => `<tr><td><div class="food-name">${esc(f.name)}</div>${f.barcode ? `<small>条码 ${esc(f.barcode)}</small>` : ""}<div class="food-meta">${esc([f.brand, f.flavor, f.category, f.weightMode].filter(Boolean).join(" · "))}</div><div class="food-meta">${esc(purchaseText(f))}</div>${f.notes ? `<div class="food-notes">${esc(f.notes)}</div>` : ""}</td>${C.keys.map((k) => `<td>${f[k] === null ? (k === "sodium" ? '<span class="badge">未提供（选填）</span>' : '<span class="badge warn">待补全</span>') : fmt(f[k])}</td>`).join("")}<td>${esc(foodFiber(f))}</td><td><button class="text-button" data-action="edit-food" data-id="${esc(f.id)}">编辑</button><button class="text-button" data-action="delete-food" data-id="${esc(f.id)}">删除</button></td></tr>`).join("")}</tbody></table>`
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
        builtinFoods
          ? `系统自带 ${builtinFoods.foods.length} 种食物 · 当前 ${state.foods.length} 种。可新增、修改或删除，个人修改保存在此浏览器。`
          : "保存真实营养标签，下次选用无需重复录入。",
      ) +
      `<section class="panel">${filters()}<div class="section-note">以下均为每100g营养标示值。克数填写实际食用净重，营养按克数直接计算。</div><div class="table-scroll" id="food-table">${foodTable()}</div></section>`
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
              )}<p class="nutrition-line">${nutritionLine(t.rows)}</p><div class="actions"><button class="primary" data-action="apply-template" data-id="${esc(t.id)}">应用到今天</button><button data-action="edit-template" data-id="${esc(t.id)}">修改</button><button data-action="template-combo" data-id="${esc(t.id)}">保存为整体</button><button class="text-button" data-action="duplicate-template" data-id="${esc(t.id)}">复制</button><button class="text-button" data-action="rename-template" data-id="${esc(t.id)}">重命名</button><button class="text-button" data-action="delete-template" data-id="${esc(t.id)}">删除</button></div></section>`,
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
      `${diaryDateNotice()}<div class="day-list">${Object.keys(state.days)
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
  function showWeightPoint(point, pinned = false) {
    const tip = $("#weight-point-tooltip");
    if (!tip) return;
    document.querySelectorAll(".weight-point.is-active").forEach(el => el.classList.remove("is-active"));
    point.classList.add("is-active");
    tip.querySelector("strong").textContent = point.dataset.weightDate;
    tip.querySelector("span").textContent = Number(point.dataset.jin).toFixed(2) + " 斤";
    tip.style.left = "clamp(75px, " + Number(point.dataset.x) / 7 + "%, calc(100% - 75px))";
    tip.style.top = Number(point.dataset.y) / 2.5 + "%";
    tip.dataset.below = Number(point.dataset.y) < 65 ? "true" : "false";
    tip.dataset.pinned = pinned ? "true" : "false";
    tip.hidden = false;
  }
  function hideWeightPoint(force = false) {
    const tip = $("#weight-point-tooltip");
    if (!tip || (!force && tip.dataset.pinned === "true")) return;
    tip.hidden = true; tip.dataset.pinned = "false";
    document.querySelectorAll(".weight-point.is-active").forEach(el => el.classList.remove("is-active"));
  }
  function weightChart(trend) {
    if (!trend.length) return empty("还没有趋势数据", "保存体重后，这里会显示最近30天的实测记录。");
    const end = Date.parse(weightDate + "T00:00:00Z"), start = end - 29 * 86400000;
    const values = trend.map(r => r.kg), low = Math.min(...values) - .3, high = Math.max(...values) + .3;
    const x = date => 48 + (Date.parse(date + "T00:00:00Z") - start) / (end - start) * 600;
    const y = kg => 25 + (high - kg) / (high - low) * 180;
    return `<div class="weight-chart-wrap"><svg class="weight-chart" viewBox="0 0 700 250" role="group" aria-label="截至${esc(weightDate)}最近30天实测体重趋势，未记录日期不补值"><title>每日体重趋势，单位斤</title><line x1="48" y1="205" x2="648" y2="205" stroke="#dce4d5"/><text x="5" y="30">${(high * 2).toFixed(1)}</text><text x="5" y="205">${(low * 2).toFixed(1)}</text><polyline points="${trend.map(r => x(r.date)+','+y(r.kg)).join(' ')}" fill="none" stroke="#52764b" stroke-width="3"/>${trend.map(r => `<circle class="weight-point" tabindex="0" role="button" aria-label="${esc(r.date)}，体重${(r.kg * 2).toFixed(2)}斤" data-weight-date="${esc(r.date)}" data-jin="${r.kg * 2}" data-x="${x(r.date)}" data-y="${y(r.kg)}" cx="${x(r.date)}" cy="${y(r.kg)}" r="4" fill="#52764b" vector-effect="non-scaling-stroke"><title>${esc(r.date)}：${r.kg * 2}斤</title></circle>`).join('')}<text x="48" y="235">${new Date(start).toISOString().slice(0,10)}</text><text x="648" y="235" text-anchor="end">${esc(weightDate)}</text></svg><div id="weight-point-tooltip" class="weight-point-tooltip" role="status" hidden><strong></strong><span></span></div></div><p class="hint">鼠标悬停或点击数据点可查看日期和体重，手机可直接点选。只显示实测点；连线用于查看趋势，未记录的日期不补值。</p>`;
  }
  function weights() {
    const entries = state.weights || {}, record = entries[weightDate], stats = C.weightStats(entries, weightDate);
    const kg = value => value === null ? "—" : (value * 2).toFixed(2) + " 斤";
    const history = Object.entries(entries).sort(([a],[b]) => b.localeCompare(a)).slice(0,365);
    const target = state.days[weightDate]?.target || profile();
    return heading("体重记录", "每天记录，关注一段时间的变化。体重记录不会自动改变营养目标。") +
      `<div class="weight-layout"><section class="panel"><h2>每日记录</h2><form id="weight-form"><label>日期<input id="weight-date" name="date" type="date" required max="${localDate()}" value="${weightDate}"></label><label>体重 斤<input name="jin" aria-label="体重斤" type="number" min="0.02" max="2000" step="any" required value="${record ? record.kg * 2 : ''}" placeholder="例如138.0"></label><label>腰围 cm（选填）<input name="waist" type="number" min="0.01" max="500" step="any" value="${record?.waist ?? ''}"></label><label>备注（选填）<input name="note" maxlength="300" value="${esc(record?.note || '')}" placeholder="例如：晨起空腹"></label><p class="hint">建议在相近条件下称重，例如晨起、如厕后。同一天保存会更新原记录。</p><div class="actions"><button type="submit" class="primary">${record ? '保存修改' : '保存体重'}</button>${record ? `<button type="button" data-action="delete-weight" data-date="${weightDate}">删除此记录</button>` : ''}</div></form></section><div><section class="panel weight-stats"><div><small>最近记录${stats.latest ? ' · ' + esc(stats.latest.date) : ''}</small><strong>${stats.latest ? kg(stats.latest.kg) : '—'}</strong></div><div><small>所选日期近7天平均 · ${stats.count}次</small><strong>${kg(stats.mean)}</strong></div><div><small>较前7天均重 · 前期${stats.priorCount}次</small><strong>${stats.change === null ? '—' : (stats.change > 0 ? '+' : '') + (stats.change * 2).toFixed(2) + ' 斤'}</strong></div><div><small>所选日期热量目标</small><strong>${fmt(target.kcal)} kcal</strong></div></section><section class="panel"><h2>最近30天趋势</h2>${weightChart(stats.trend)}<p class="hint">均重按对应7个自然日内的已记录数据计算；缺失日期不当作0，两个时段都有记录才显示均重变化。</p></section></div></div><section class="panel"><h2>历史记录</h2><p class="hint">显示最近365条；其他日期可通过上方日期框查询、补记或修改。数据随完整JSON备份导出。</p>${history.length ? `<div class="table-scroll"><table><thead><tr><th>日期</th><th>体重 斤</th><th>腰围 cm</th><th>备注</th><th>操作</th></tr></thead><tbody>${history.map(([date,r]) => `<tr><td>${date}</td><td>${fmt(r.kg * 2)}</td><td>${r.waist ?? '—'}</td><td>${esc(r.note || '')}</td><td><button class="text-button" data-action="edit-weight" data-date="${date}">编辑</button><button class="text-button" data-action="delete-weight" data-date="${date}">删除</button></td></tr>`).join('')}</tbody></table></div>` : empty("还没有体重记录", "先保存第一条体重，也可以选择过去的日期补记。")}</section>`;
  }
  function filePanel() {
    const supported = !!(window.showOpenFilePicker && window.showSaveFilePicker);
    return `<section class="panel"><h2>保存到实际JSON文件</h2><p class="hint">选择电脑上的JSON文件后，食物、套餐、每日饮食、体重和目标的修改会自动写入它。清浏览器缓存不会删除这个文件。再次打开网页时，需重新选择同一文件授权读取。</p>${supported ? '' : '<p class="notice warn">当前浏览器不支持直接读写文件。请用支持此功能的Chrome/Edge，并通过localhost或HTTPS打开；也可导出JSON或配置GitHub同步。</p>'}<div class="actions"><button data-action="file-create" ${!supported || fileBinding || fileBusy ? 'disabled' : ''}>新建JSON文件并迁入本页数据</button><button data-action="file-open" ${!supported || fileBinding || fileBusy ? 'disabled' : ''}>打开已有JSON文件继续使用</button><button data-action="file-save" ${!fileStore || fileBusy ? 'disabled' : ''}>立即保存／重试</button><button data-action="export">导出当前数据副本</button></div><p class="hint">建议文件放在文档或专门的数据目录，不要放浏览器缓存目录。普通本地文件不会自动在手机电脑间同步；多端仍可使用GitHub JSON。</p></section>`;
  }
  function fileStatus() {
    return `<section class="notice file-storage" aria-live="polite"><strong id="file-status-text"></strong><div class="actions"><button data-action="file-open">打开JSON文件</button><button data-action="file-create">新建JSON文件</button>${fileStore ? '<button data-action="file-save">立即保存／重试</button>' : ''}<button data-action="export">导出副本</button></div></section>`;
  }
  function updateFileStatus() {
    const el = $("#file-status-text");
    if (el) el.textContent = fileBinding ? "正在连接JSON文件…" : fileBusy ? "正在写入JSON文件，请勿关闭页面…" : fileMessage || (fileStore ? fileDirty ? "有修改尚未写入JSON，请重试或导出" : "全部数据已保存到文件：" + fileStore.handle.name : fileMode ? "请重新打开你的JSON文件后继续使用" : "当前仅浏览器保存。请绑定JSON文件，避免清缓存后丢失数据。");
  }
  function queueFileSave() {
    const snapshot = JSON.stringify(state);
    fileDirty = true; fileBusy++; fileMessage = ""; updateFileStatus();
    Promise.resolve().then(() => fileStore.save(JSON.parse(snapshot))).then(() => {
      fileDirty = JSON.stringify(state) !== snapshot;
      fileMessage = fileDirty ? "文件已写入，仍有新修改等待写入" : "全部数据已保存到文件：" + fileStore.handle.name;
    }).catch(error => {
      fileDirty = true;
      fileMessage = "JSON保存失败，当前修改仍在页面中：" + error.message;
      toast(fileMessage + "。请重试或导出备份");
    }).finally(() => { fileBusy--; updateFileStatus(); });
  }
  async function bindJsonFile(create) {
    if (fileBinding || fileBusy || cloudWorking) { toast("请等待当前保存完成"); return; }
    if (!window.showSaveFilePicker || !window.showOpenFilePicker) { toast("当前浏览器不支持直接读写JSON文件，请使用Chrome/Edge或导出JSON"); return; }
    if (((fileStore && fileDirty) || cloudDirty) && !confirm("本页有未保存修改，建议先导出副本。仍要选择文件吗？")) return;
    if (create && storageError.startsWith("本地数据读取失败")) { toast("请先导出并恢复损坏的原数据"); return; }
    fileBinding = true; updateFileStatus();
    try {
      const options = {types:[{description:"JSON个人数据",accept:{"application/json":[".json"]}}]};
      const handle = create ? await window.showSaveFilePicker({...options,suggestedName:"轻盘个人数据.json"}) : (await window.showOpenFilePicker({...options,multiple:false,mode:"readwrite"}))[0];
      if (!handle) return;
      if (handle.queryPermission && await handle.queryPermission({mode:"readwrite"}) !== "granted" && await handle.requestPermission({mode:"readwrite"}) !== "granted")
        throw Error("未获得写入权限，未切换保存方式");
      const store = new LocalJsonStorage.Store(handle,C.validateState);
      let loaded;
      if (create) { loaded = C.clone(state); await store.create(loaded); }
      else loaded = await store.load();
      state = builtinFoods ? C.installBuiltinFoods(loaded,builtinFoods).state : C.clone(loaded);
      C.fillFiberDefaults(state.foods,builtinFoods?.foods || []);
      fileStore = store; fileMode = true; fileDirty = false;
      cloudConfig = null; cloudStore = null; cloudConnected = false; cloudDirty = false;
      try { localStorage.setItem("qingpan.fileMode","1"); localStorage.removeItem("qingpan.githubConfig"); } catch {}
      storageError = ""; fileMessage = ""; invalidate(); mealRowOrder.clear(); editingTemplate = null;
      render(); queueFileSave();
    } catch (error) {
      if (error.name !== "AbortError") { fileMessage = "文件连接失败：" + error.message; toast(fileMessage); }
    } finally { fileBinding = false; updateFileStatus(); }
  }
  function cloudPanel() {
    const c = cloudConfig || {owner:"13161324809",repo:"qingpan-personal-data",branch:"main",path:"personal-data.json"};
    return `<section class="panel"><h2>GitHub个人JSON同步</h2><p class="hint">食物、价格、套餐、饮食记录、体重和目标共用一个JSON文件。建议使用独立私有仓库；公开仓库中的个人数据任何人都能读取。</p><form id="cloud-form" class="form-grid"><label>GitHub用户名<input name="owner" required value="${esc(c.owner)}"></label><label>数据仓库<input name="repo" required value="${esc(c.repo)}"></label><label>分支<input name="branch" required value="${esc(c.branch)}"></label><label>文件路径<input name="path" required value="${esc(c.path)}"></label><label>访问令牌<input name="token" type="password" autocomplete="off" placeholder="${cloudToken ? '本会话已有令牌，留空沿用' : '填写fine-grained token'}"></label><p class="hint">仓库需先创建并带初始提交。令牌仅限此数据仓库，Contents设为Read and write。令牌只保存在当前标签页会话，不进入备份、JSON文件或代码。</p><button type="submit">保存连接配置</button></form><div class="actions"><button data-action="cloud-load" ${!cloudConfig || cloudWorking ? 'disabled' : ''}>从GitHub加载</button><button data-action="cloud-create" ${!cloudConfig || cloudConnected || cloudWorking ? 'disabled' : ''}>首次上传本机数据</button><button data-action="export">导出当前数据备份</button></div><p class="hint">启用后，个人数据修改保留在页面内存中，点“保存到GitHub”才写入云端；不再写入浏览器个人数据存储。其他设备点“从GitHub加载”获取最新数据。原有本地数据暂保留作迁移备份。</p></section>`;
  }
  function cloudStatus() {
    return `<section class="notice cloud-sync" aria-live="polite"><strong id="cloud-status-text"></strong><div class="actions"><button data-action="cloud-save" ${!cloudConnected || cloudWorking ? 'disabled' : ''}>保存到GitHub</button><button data-action="cloud-load" ${cloudWorking ? 'disabled' : ''}>从GitHub加载</button><button data-action="export">导出备份</button></div></section>`;
  }
  function updateCloudStatus() {
    const el = $("#cloud-status-text");
    if (el) el.textContent = cloudWorking ? "正在连接GitHub…" : (cloudMessage || (cloudConnected ? cloudDirty ? "有未保存的修改，请保存到GitHub" : "已与GitHub个人JSON同步" : "GitHub模式尚未连接，请配置令牌并加载或首次上传"));
  }
  async function cloudAction(action) {
    if (cloudWorking) return;
    if (!cloudConfig || !cloudToken) { toast("请先在个人设置填写数据仓库和访问令牌"); return; }
    if (action === "load" && cloudConnected && cloudDirty && !confirm("本页有未保存修改，建议先导出备份。仍要用云端数据替换本页吗？")) return;
    cloudWorking = true; cloudMessage = ""; render();
    try {
      const store = cloudStore || new GithubJsonStorage.Store(cloudConfig,cloudToken,C.validateState);
      const snapshot = JSON.stringify(state);
      if (action === "load") {
        const next = await store.load();
        const loaded = builtinFoods ? C.installBuiltinFoods(next,builtinFoods).state : C.clone(next);
        C.fillFiberDefaults(loaded.foods,builtinFoods?.foods || []);
        state = loaded; cloudDirty = JSON.stringify(state) !== JSON.stringify(next);
        invalidate(); mealRowOrder.clear(); editingTemplate = null; storageError = "";
      } else {
        if (action === "create") {
          if (storageError) throw Error("请先导出并恢复损坏的本地数据，再首次上传");
          await store.create(JSON.parse(snapshot));
        } else await store.save(JSON.parse(snapshot));
        cloudDirty = JSON.stringify(state) !== snapshot;
      }
      cloudStore = store; cloudConnected = true;
      cloudMessage = cloudDirty ? "已连接GitHub；本页有更新尚未保存" : "GitHub个人JSON已同步";
    } catch (error) { cloudMessage = error.message; toast(error.message); }
    finally { cloudWorking = false; render(); }
  }
  function settings() {
    const t = profile();
    return (
      heading(
        "照顾自己，从合适的目标开始。",
        "目标、餐次和数据都由你掌握。设置仅由你确认保存。",
      ) +
      `<div class="settings-grid"><section class="panel"><h2>营养目标方案</h2><div class="profile-toolbar"><select id="profile" aria-label="目标方案">${state.profiles.map((p) => `<option value="${esc(p.id)}" ${p.id === state.activeProfile ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select><button data-action="new-profile">＋ 新方案</button><button class="text-button" data-action="delete-profile">删除</button></div><form id="target-form"><div class="form-grid"><label>方案名称<input name="name" required maxlength="80" value="${esc(t.name)}"></label><label>每日热量 kcal<input type="number" name="kcal" required min="1" step="any" value="${t.kcal}"></label><label>蛋白质目标 g（下限）<input type="number" name="protein" min="0" step="any" required value="${t.protein}"></label><label>脂肪目标 g<input type="number" name="fat" min="0" step="any" required value="${t.fat}"></label><label class="checkbox-label"><input type="checkbox" name="autoCarbs" ${t.autoCarbs ? "checked" : ""}>按 4/9/4 系数自动计算剩余碳水目标</label><label>碳水目标 g<input type="number" name="carbs" min="0" step="any" required value="${t.autoCarbs ? C.targetBounds(t).carbs.target : t.carbs}" ${t.autoCarbs ? "readonly" : ""}></label><label class="checkbox-label"><input type="checkbox" name="enforceSodium" ${C.sodiumEnabled(t) ? "checked" : ""}>严格限制钠（开启后需补齐所有所选食物的钠数据）</label><label>每日钠上限 mg<input type="number" name="sodium" min="0" step="any" ${C.sodiumEnabled(t) ? "required" : "disabled"} value="${t.sodium ?? 2000}"></label><p class="hint">默认只按热量、蛋白质、脂肪和碳水配餐；钠可以留空，不参与约束。</p><div class="form-section">允许范围 <small>自动配餐必须满足这些范围；无解时显示差额参考结果。</small></div><label>热量允许偏差 ± %<input type="number" name="energyTolerance" min="0" max="100" step="any" required value="${t.energyTolerance}"></label><label>脂肪允许偏差 ± g<input type="number" name="fatTolerance" min="0" step="any" required value="${t.fatTolerance}"></label><label>碳水允许偏差 ± g<input type="number" name="carbTolerance" min="0" step="any" required value="${t.carbTolerance}"></label></div><div class="settings-actions"><button type="submit" class="primary">保存并应用到 ${esc(date)}</button></div><p class="hint" style="margin-top:12px">1700kcal 等初始数值只是可修改的起始设置，并非个人营养建议。标签热量直接用于求解，不强制等于三大营养素的4/9/4折算热量。</p></form></section><div><section class="panel"><details><summary>餐次设置（可选，用于历史记录）</summary><form id="meals-form"><label>餐次名称（每行一餐，最多8餐）<textarea name="meals" rows="4" required>${esc(day().meals.join("\n"))}</textarea></label><p class="hint">保存后应用于 ${esc(date)} 及今后新建日期。现有条目按原餐次顺序对应；减少的餐次合并至最后一餐。</p><button class="primary" type="submit">保存餐次</button></form></details></section><section class="panel"><h2>备份与恢复</h2><p class="section-note">${fileMode ? "已启用实际JSON文件保存；修改后请等待页面提示文件写入成功。" : cloudConfig ? "已启用GitHub个人JSON；用页面上方按钮保存和加载，手机电脑使用相同仓库和文件。" : "当前使用浏览器本地保存。建议在下方绑定实际JSON文件，或配置GitHub个人JSON同步。"}</p><div class="actions"><button class="primary" data-action="export">↗ 导出完整 JSON</button><button data-action="import">导入备份</button>${rawBackup && storageError ? '<button data-action="raw-export">导出原始损坏数据</button>' : ""}</div><p class="hint" style="margin-top:15px">导入前会校验结构。导入会替换当前数据，请先导出备份。清理浏览器数据会清除本地记录。</p></section><section class="panel right-note"><strong>关于轻盘</strong>无后端 · 无付费 AI · 无第三方统计<br>优化算法：混合整数线性规划<br>求解器：jsLPSolver 1.0.3 / Unlicense<br>v1.1 · 已支持每日体重记录，云同步留待后续版本。</section></div></div>`
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
      (cloudConfig ? cloudStatus() : fileStatus()) + (storageError
        ? `<div class="notice error">${esc(storageError)} <button data-action="raw-export">导出原始数据</button></div>`
        : "") + (cloudConfig && cloudWorking ? '<section class="panel">正在同步，请稍候。当前数据会保留到同步完成。</section>' : cloudConfig && !cloudConnected ? filePanel() + cloudPanel() : fileMode && !fileStore ? filePanel() + cloudPanel() : { today, foods, templates, records, weights, settings }[page]() + (page === "settings" ? filePanel() + cloudPanel() : ""));
    updateCloudStatus();
    updateFileStatus();
  }
  let comboDraft = [];
  function addComboIngredient(food, grams = 1) {
    const choices = state.foods.filter(f => !f.isComposite);
    food = food || choices[0];
    if (!food) throw Error("请先录入原料食物");
    if (!choices.some(f => f.id === food.id)) choices.push(food);
    const index = comboDraft.push(C.clone(food)) - 1;
    const row = document.createElement("div");
    row.className = "combo-ingredient";
    row.dataset.index = index;
    row.innerHTML = `<label>原料<select aria-label="配方原料">${choices.map(f => `<option value="${esc(f.id)}" ${f.id === food.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select></label><label>克数<input aria-label="原料克数" type="number" min="0.001" max="10000" step="any" required value="${grams}"></label><button type="button" data-action="combo-remove">移除</button>`;
    $("#combo-ingredients").append(row);
  }
  function openCombo(food, template) {
    const form = $("#combo-form");
    form.reset();
    form.elements.id.value = food?.id || "";
    form.elements.name.value = food?.name || template?.name || "";
    comboDraft = [];
    $("#combo-ingredients").innerHTML = "";
    const rows = food?.ingredients || template?.rows;
    if (rows) rows.filter(r => r.grams > 0).forEach(r => addComboIngredient(r.food, r.grams));
    else addComboIngredient();
    $("#combo-dialog").showModal();
  }
  function openFood(id) {
    const composite = state.foods.find(f => f.id === id && f.isComposite);
    if (composite) { openCombo(composite); return; }
    const form = $("#food-form");
    form.reset();
    form.elements.category.innerHTML = opts(foodCategories(), categories[0]);
    const f = state.foods.find((f) => f.id === id);
    $("#food-dialog-title").textContent = f ? "编辑食物" : "新增食物";
    form.elements.id.value = f?.id || "";
    if (f) {
      for (const k of [
        "name",
        "category",
        "brand",
        "barcode",
        "flavor",
        "weightMode",
        "unitGrams",
        "price",
        "notes",
        ...C.keys.slice(1),
      ])
        form.elements[k].value = f[k] ?? "";
      form.elements.energy.value = f.kcal ?? "";
    }
    form.elements.countMode.checked = f ? C.counted(f) : false;
    const fiber = f ? C.fiberTotals([{food:f,grams:100}],state.foods) : {grams:0,estimated:true};
    form.elements.fiber.value = fiber.grams;
    form.elements.fiberEstimated.checked = fiber.estimated;
    const p = f?.purchase;
    for (const [field, key] of Object.entries({purchaseAmount:"amount", purchaseQuantity:"quantity", purchaseUnit:"unit", purchaseDensity:"density", purchaseNote:"note"}))
      form.elements[field].value = p?.[key] ?? (field === "purchaseUnit" ? "g" : "");
    form.elements.purchaseYield.value = p ? (p.yield === null ? "" : p.yield * 100) : 100;
    form.elements.purchaseEstimated.checked = p?.estimated === true;
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
    followsToday = true;
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
      const calorieInput = $("#quick-kcal");
      if (calorieInput) {
        if (!calorieInput.value.trim() || !calorieInput.checkValidity()) {
          calorieInput.reportValidity();
          return;
        }
        const kcal = Number(calorieInput.value);
        if (kcal !== day().target.kcal) {
          day().target = C.scaleTargetCalories(day().target, kcal);
          persist();
        }
      }
      C.validateRows(day().plan, day().meals, day().target);
      C.targetBounds(day().target);
    } catch (e) {
      toast(e.message);
      return;
    }
    busy = true;
    results = [];
    variant = 0;
    render();
    const input = {
      rows: C.clone(day().plan),
      target: C.clone(day().target),
      meals: C.clone(day().meals),
    };
    const sourceDate = date;
    try {
      solveJob = MealSolver.createJob(input, {
        onProgress: ({ variant, completed }) => {
          solveProgress = `正在计算方案${variant}（${completed}/3）`;
          render();
        },
      });
      const out = await solveJob.promise;
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
      variant = results.findIndex((r) => r.valid && r.rows.length);
      if (variant < 0)
        variant = Math.max(
          0,
          results.findIndex((r) => r.rows.length),
        );
      if (results[variant].rows.length)
        day().plan = C.clone(results[variant].rows);
      persist();
      toast(
        results[variant].valid
          ? results.some((r) => !r.rows.length)
            ? "已获得可行配餐，部分方案未完成，可查看提示"
            : "已计算并核验当前启用的营养约束"
          : "目标存在冲突或未找到可行解，请查看差额提示",
      );
    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
      solveJob = null;
      solveProgress = "";
      render();
    }
  }
  const actions = {
    "file-create": () => bindJsonFile(true),
    "file-open": () => bindJsonFile(false),
    "file-save": () => { if (fileStore && !fileBusy) queueFileSave(); },
    "diary-today": () => { selectDiaryDate(localDate()); render(); },
    "cloud-save": () => cloudAction("save"),
    "cloud-load": () => cloudAction("load"),
    "cloud-create": () => cloudAction("create"),
    "sort-meal": (el) => {
      const actual = el.dataset.actual === "true";
      sortRows(day()[actual ? "actual" : "plan"],actual,true);
      render();
    },
    "edit-weight": (el) => { weightDate = el.dataset.date; render(); $("#weight-form").scrollIntoView?.({block:"start"}); },
    "delete-weight": (el) => {
      if (!confirm("删除 " + el.dataset.date + " 的体重记录？")) return;
      delete (state.weights || {})[el.dataset.date];
      persist(); render(); toast("体重记录已删除");
    },
    "new-combo": () => openCombo(),
    "combo-add": () => addComboIngredient(),
    "combo-remove": (el) => el.closest(".combo-ingredient").remove(),
    "template-combo": (el) => openCombo(null, state.templates.find(t => t.id === el.dataset.id)),
    "cancel-solve": () => solveJob?.cancel(),
    "restore-builtin": () => {
      if (!builtinFoods) throw Error("自带食物库未加载，请刷新后重试");
      if (storageError && rawBackup) throw Error("请先恢复损坏的本地数据");
      const merged = C.mergeFoodPack(state, builtinFoods);
      state = merged.state;
      state.builtinFoodsSeen = [
        ...new Set([
          ...(state.builtinFoodsSeen || []),
          ...builtinFoods.foods.map((f) => f.id),
        ]),
      ];
      persist();
      render();
      toast(`已恢复${merged.added}种自带食物，保留${merged.skipped}种已有食物`);
    },
    "go-settings": () => (location.hash = "settings"),
    "go-today": () => { nextRouteDate = page === "records" ? date : localDate(); location.hash = "today"; },
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
      if (!f) throw Error("食物不存在，请刷新后重试");
      if (day().plan.some((r) => productId(r.food.id) === productId(f.id))) {
        toast("今天已选过这种食物，修改克数即可；移除后可以重新选择");
        return;
      }
      day().plan.push({
        id: uid(),
        food: C.clone(f),
        meal: day().meals[0],
        grams: C.counted(f) ? f.unitGrams : 100,
        min: 0,
        max: f.isComposite ? 10000 : 500,
        step: 5,
        fixed: f.isComposite === true,
      });
      invalidate();
      persist();
      render();
      toast("已添加食材，可直接计算或调整重量范围");
    },
    "remove-row": (el) => {
      const key = el.dataset.actual === "true" ? "actual" : "plan";
      day()[key] = day()[key].filter((r) => r.id !== el.dataset.id);
      if (key === "plan") invalidate();
      persist();
      render();
    },
    "count-minus": (el) => changeCount(el, -1),
    "count-plus": (el) => changeCount(el, 1),
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
      if (date !== localDate() && !confirm("当前选择的是 " + date + "，将补记到这个日期，而不是今天。继续？")) return;
      if (d.actual.length && !confirm("用 " + date + " 的计划替换该日实际记录？")) return;
      d.actual = C.clone(d.plan);
      const saved = persist();
      render();
      toast(saved === "local" ? "已保存到本机：" + date + " 的实际饮食" : saved === "file-pending" ? "已记入 " + date + "，正在写入JSON文件" : saved === "cloud-pending" ? "已记入 " + date + "，请点击保存到GitHub" : "保存失败：当前记录仅在页面内存，请立即导出备份");
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
      selectDiaryDate(el.dataset.value);
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
  document.addEventListener("submit", (e) => {
    if (e.target.id === "cloud-form") {
      e.preventDefault();
      guarded(() => {
        if (cloudWorking) throw Error("请等待当前同步完成");
        if (fileStore && (fileBusy || fileDirty)) throw Error("请先等待JSON写入完成，失败时先重试或导出副本");
        if (cloudConnected && cloudDirty) throw Error("请先保存或导出本页修改，再更换同步配置");
        const form = e.target;
        const config = GithubJsonStorage.config(Object.fromEntries(["owner","repo","branch","path"].map(k => [k,form.elements[k].value])));
        const token = form.elements.token.value.trim() || cloudToken;
        if (!token) throw Error("请填写GitHub访问令牌");
        localStorage.setItem("qingpan.githubConfig",JSON.stringify(config));
        sessionStorage.setItem("qingpan.githubToken",token);
        fileMode = false; fileStore = null; localStorage.removeItem("qingpan.fileMode");
        cloudConfig = config; cloudToken = token; cloudStore = null; cloudConnected = false; cloudDirty = false;
        cloudMessage = "连接配置已保存；已有文件请选择从GitHub加载，首次迁移请选择首次上传本机数据。";
        render();
      });
      return;
    }
    if (e.target.id !== "weight-form") return;
    e.preventDefault();
    guarded(() => {
      const form = e.target, date = form.elements.date.value;
      const record = {kg:Number(form.elements.jin.value) / 2, waist:form.elements.waist.value.trim() === "" ? null : Number(form.elements.waist.value), note:form.elements.note.value.trim()};
      C.validateWeightRecord(date, record);
      if (date > localDate()) throw Error("不能记录未来日期的体重");
      state.weights = {...(state.weights || {}), [date]:record};
      weightDate = date;
      persist(); render(); toast("体重记录已保存");
    });
  });
  document.addEventListener("click", (e) => {
    if (refreshCalendarDate()) { toast("已切换到今天 " + date + "，请核对当前计划后再操作"); return; }
    const navLink = e.target.closest?.('#nav a');
    if (navLink && navLink.getAttribute("href") === location.hash) { route(); return; }
    const point = e.target.closest?.(".weight-point");
    if (point) { showWeightPoint(point,true); return; }
    hideWeightPoint(true);
    const close = e.target.closest("[data-close]");
    if (close) {
      document.getElementById(close.dataset.close).close();
      return;
    }
    const el = e.target.closest("[data-action]");
    if (el) guarded(() => actions[el.dataset.action]?.(el));
  });
  document.addEventListener("pointerover", e => {
    const point = e.target.closest?.(".weight-point");
    if (point) showWeightPoint(point);
  });
  document.addEventListener("pointerout", e => {
    if (e.target.closest?.(".weight-point")) hideWeightPoint();
  });
  document.addEventListener("focusin", e => {
    if (e.target.matches?.(".weight-point")) showWeightPoint(e.target);
  });
  document.addEventListener("focusout", e => {
    if (e.target.matches?.(".weight-point")) hideWeightPoint();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") hideWeightPoint(true);
    if (e.target.matches?.(".weight-point") && ["Enter"," "].includes(e.key)) { e.preventDefault(); showWeightPoint(e.target,true); }
  });
  document.addEventListener("input", (e) => {
    if (e.target.name === "fiber" && e.target.closest("#food-form"))
      $("#food-form").elements.fiberEstimated.checked = e.target.value.trim() === "";
    if (e.target.id === "search") {
      search = e.target.value;
      if (page === "today") $("#picker").innerHTML = picker();
      if (page === "foods") $("#food-table").innerHTML = foodTable();
    }
    if (e.target.closest("#target-form")) {
      const f = $("#target-form");
      f.elements.sodium.disabled = !f.elements.enforceSodium.checked;
      f.elements.sodium.required = f.elements.enforceSodium.checked;
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
      if (refreshCalendarDate()) { toast("已切换到今天 " + date + "，请重新核对记录日期"); return; }
      const el = e.target;
      if (el.id === "weight-date") {
        if (!C.validRecordDate(el.value) || el.value > localDate()) { render(); throw Error("请选择今天或过去的有效日期"); }
        weightDate = el.value; render();
      } else if (el.id === "meal-sort-field" || el.id === "meal-sort-direction") {
        const sort = mealSort();
        if (el.id === "meal-sort-field" && Object.hasOwn(sortFields, el.value)) sort.field = el.value;
        if (el.id === "meal-sort-direction") sort.direction = el.value === "asc" ? "asc" : "desc";
        state.mealSort = sort;
        persist(); render();
      } else if (el.id === "quick-kcal") {
        if (el.value.trim() && el.checkValidity()) {
          day().target = C.scaleTargetCalories(day().target, Number(el.value));
          invalidate();
          persist();
        }
      } else if (el.id === "date") {
        selectDiaryDate(el.value);
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
        const field = el.dataset.field;
        if (["count", "minCount", "maxCount"].includes(field)) {
          const count = Number(el.value);
          if (!el.value.trim() || !Number.isInteger(count) || count < 0 || count * r.food.unitGrams > 10000) {
            render();
            throw Error("请输入有效的非负整数个数");
          }
          const key = {count:"grams", minCount:"min", maxCount:"max"}[field];
          const grams = count * r.food.unitGrams;
          if ((key === "min" && grams > r.max) || (key === "max" && grams < r.min)) {
            render(); throw Error("最少个数不能大于最多个数");
          }
          r[key] = grams;
          if (!actual) invalidate();
          persist(); render(); return;
        }
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
  $("#combo-form").addEventListener("submit", (e) => {
    e.preventDefault();
    guarded(() => {
      const form = e.target;
      const rows = [...document.querySelectorAll(".combo-ingredient")].map(el => {
        const id = el.querySelector("select").value;
        const snapshot = comboDraft[Number(el.dataset.index)];
        const food = snapshot?.id === id ? snapshot : state.foods.find(f => f.id === id);
        if (!food) throw Error("原料已不存在，请重新选择");
        const fiber = C.fiberTotals([{food,grams:100}],state.foods);
        return {food:{...food,fiber:fiber.grams,fiberEstimated:fiber.estimated}, grams: Number(el.querySelector("input").value)};
      });
      const food = C.compositeFood(form.elements.id.value || uid(), form.elements.name.value, rows);
      const index = state.foods.findIndex(f => f.id === food.id);
      if (index < 0) state.foods.push(food); else state.foods[index] = food;
      persist();
      $("#combo-dialog").close();
      render();
      toast("组合套餐已保存，每日可作为一个整体选用；已有记录保留原配方快照");
    });
  });
  $("#food-form").addEventListener("submit", (e) => {
    e.preventDefault();
    guarded(() => {
      const form = e.target,
        fd = new FormData(form);
      const text = (k) => String(fd.get(k) || "").trim(),
        num = (k) => (text(k) === "" ? null : Number(text(k)));
      const f = {
        ...(state.foods.find(food => food.id === text("id")) || {}),
        id: text("id") || uid(),
        name: text("name"),
        category: text("category"),
        brand: text("brand"),
        barcode: text("barcode"),
        countMode: form.elements.countMode.checked,
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
        fiber: num("fiber") ?? 0,
        fiberEstimated: form.elements.fiberEstimated.checked || num("fiber") === null,
        sodium: num("sodium"),
        weightMode: text("weightMode"),
        unitGrams: num("unitGrams"),
        price: num("price"),
        purchase: num("purchaseAmount") === null ? null : {
          ...(state.foods.find(food => food.id === text("id"))?.purchase || {}),
          amount: num("purchaseAmount"), quantity: num("purchaseQuantity"), unit: text("purchaseUnit"),
          yield: num("purchaseYield") === null ? null : num("purchaseYield") / 100,
          density: num("purchaseDensity"), estimated: form.elements.purchaseEstimated.checked, note: text("purchaseNote")
        },
        notes: text("notes"),
      };
      const previousFood = state.foods.find(food => food.id === f.id);
      if (previousFood?.fiber !== f.fiber || previousFood?.fiberEstimated !== f.fiberEstimated)
        f.fiberSource = f.fiberEstimated ? "未提供，按用户要求暂填0" : "用户手动录入的每100g膳食纤维";
      C.validateFood(f);
      if (f.barcode && state.foods.some(other => other.id !== f.id && other.barcode === f.barcode))
        throw Error("该条码已有食物，请编辑原记录，不要重复添加");
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
    if (e.target.id === "quick-target-form") {
      e.preventDefault();
      calculate();
      return;
    }
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
        t.enforceSodium = fd.has("enforceSodium");
        t.sodium = t.enforceSodium
          ? Number(fd.get("sodium"))
          : (profile().sodium ?? 2000);
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
      C.fillFiberDefaults(state.foods,builtinFoods?.foods || []);
      // Restoring a full backup preserves its exact food selection, even when
      // it predates built-in catalogs. Missing defaults remain intentionally absent.
      if (builtinFoods)
        state.builtinFoodsSeen = [
          ...new Set([
            ...(state.builtinFoodsSeen || []),
            ...builtinFoods.foods.map((f) => f.id),
          ]),
        ];
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
  window.addEventListener("focus", refreshCalendarDate);
  window.addEventListener("pageshow", refreshCalendarDate);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshCalendarDate(); });
  setInterval(refreshCalendarDate,60000);
  window.addEventListener("beforeunload", (e) => {
    if ((cloudConfig && cloudConnected && cloudDirty) || (fileMode && fileStore && (fileDirty || fileBusy))) { e.preventDefault(); e.returnValue = ""; }
  });
  if (builtinFoods && !storageError) {
    try {
      const installed = C.installBuiltinFoods(state, builtinFoods);
      state = installed.state;
      if (installed.changed) persist();
    } catch (e) {
      toast("自带食物库加载失败：" + e.message);
    }
  }
  if (!storageError) {
    const before = JSON.stringify(state.foods);
    C.fillFiberDefaults(state.foods,builtinFoods?.foods || []);
    if (before !== JSON.stringify(state.foods)) persist();
  }
  route();
})();
