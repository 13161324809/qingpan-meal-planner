# 数据模型与计算设计

## 存储模型（版本1）

根对象：`{version, foods, profiles, activeProfile, meals, templates, days}`，以JSON保存在 `localStorage['qingpan.v1']`。导入在替换前做结构和数值校验；不使用导入文件中的可执行代码。

现另含可选字段 `builtinFoodsSeen: string[]`，保存已经初始化过的自带食物编号。`data/foods.json` 是公开随应用发布的系统基础库；初始化只添加未见过的编号，随后个人删除和编辑通过本地完整食物表及此元数据保留，不由重新载入基础库覆盖。完整备份同时保留初始化记录，兼容不含此字段的旧备份。

- Food：`id,name,brand,flavor,category,kcal,protein,fat,carbs,sodium,weightMode,edibleRatio,nutritionBasis,unitGrams,price,notes`。营养字段是每100g标示值，`null`代表未知，零与未知严格区分。`price`为每100g实际称重口径的可选单价，当前版本只保存，不作为优化目标。
- Target：`id,name,kcal,protein,fat,carbs,autoCarbs,sodium,energyTolerance,fatTolerance,carbTolerance`。
- Row：`id,food,meal,grams,min,max,step,fixed`，其中food为独立快照。
- Day：以本地日期YYYY-MM-DD为键，`{meals,target,plan:Row[],actual:Row[]}`。plan和actual互不共用对象。
- Template：`{id,name,meals,target,rows,summary,updatedAt}`。summary为保存时核算结果；加载时仍根据rows重算，避免信任导入汇总值。应用套餐使用当前目标方案核验，原目标快照留在套餐中。

## 营养系数

记食物i的每100g营养k为 `a[i,k]`。如果标签按可食部分标示，系数 `p[i] = edibleRatio`，否则 `p[i] = 1`。

`total[k] = Σ a[i,k] × p[i] × grams[i] / 100`。

内部不为显示而取整；显示最多一位小数。判断容差为1e-5，避免浮点舍入产生微小假超标。缺任何一项核心营养值的食物不得参与自动求解，手动记录则显示该项未知。

## 混合整数线性模型

求解库：jsLPSolver 1.0.3。使用其线性规划与整数约束分支搜索，避免启发式分摊热量。模型为非负变量、线性约束、线性目标。

自由食物：`grams[i] = step[i] × x[i]`，`x[i]`为非负整数。

`ceil(min[i]/step[i]) <= x[i] <= floor(max[i]/step[i])`。

固定食物以一个连续变量和等式 `grams[i]=固定值` 表示；不要求用户固定的53g变成55g。固定值仍需在设定范围内。餐次是条目元数据，模型不改变餐次。

硬营养约束：

- 热量：`kcalTarget×(1−tolerance/100) <= totalKcal <= kcalTarget×(1+tolerance/100)`。
- 蛋白质：`totalProtein >= proteinTarget`。
- 脂肪：`max(0,fatTarget−fatTolerance) <= totalFat <= fatTarget+fatTolerance`。
- 碳水：同脂肪。
- 钠：`totalSodium <= sodiumLimit`。

目标值偏差用 `total[k] + under[k] − over[k] = target[k]` 表示，其中under、over为非负连续变量。最小化加权的 `under+over`，按目标值（至少1）归一化。

| 模式 | 热量权重 | 蛋白质权重 | 脂肪权重 | 碳水权重 | 额外目标                         |
| ---- | -------: | ---------: | -------: | -------: | -------------------------------- |
| A    |       12 |         14 |        2 |        2 | 无                               |
| B    |        3 |          4 |        1 |        1 | 8×总钠/max(钠上限,1)             |
| C    |        4 |          5 |        2 |        2 | 份量区间中点偏差及归一化位置差异 |

C中自由条目接近各自范围中点的偏差权重为 `3/max(1,max−min)`。另以首个非退化自由条目为锚点，惩罚各条目在自己范围内的归一化位置差的绝对值，权重6。它避免只有中点L1偏差时出现「0g与200g」和「100g与100g」同分的问题。固定条目不受份量均衡惩罚。加权目标是明确的偏好，不是严格的词典序优先级。

## 无解与超时

严格模型未找到可行解时，重试松弛模型：保留所有份量与固定约束，营养下界增加正松弛、上界增加负松弛，每单位违约成本为 `10000/max(target,1)`，同时保留原偏好目标。

松弛模型只是提供差额可见的参考，不是证明单项约束就是唯一冲突原因，也不是严格计算最小不可满足子集。各项不足／超出均按最终克数重新核算展示。范围不足、固定食品含钠太高、宏量比例不匹配、整数网格太粗均可能造成冲突。

每次求解限时1800ms。不把时限内没找到解直接声称为数学证明无解，也不声称已证明全局最优。浏览器worker设20秒总时限并在过期时终止。直接file打开时无法使用worker，主线程仅受求解器单模型时限控制。

## 独立结果核验

从求解器返回值恢复克数前验证整数精度，恢复后检查份量上下限，并用纯营养函数重新核算五项营养。结果只在重新核验全部通过时标记valid。求解器的feasible标志不直接等于营养达标；松弛解可能feasible但营养不达标。

测试包含解析结果可预知的单食物问题、固定非整数步长问题、整数网格无解、超钠、缺失数据、A/B/C，以及小模型在网格上穷举所有组合，对照求解器的目标值。

## 扩展方向

账号同步可在根数据之外添加持久化适配层。当前视图、食物快照与纯数学模块已分开，便于加入远程版本号、冲突处理和历史版本。体重模块可单独添加日期记录，不应悄悄改写Target。
