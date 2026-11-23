# GitHub个人JSON同步

个人数据共用一个JSON：食物、采购价格、套餐、组合套餐、目标、饮食记录、每日体重等。网页代码可继续使用现有GitHub Pages。

## 首次配置

1. 在GitHub创建独立私有仓库，例如 `qingpan-personal-data`，勾选添加README，使 `main` 分支存在。私有仓库保护饮食、体重等记录；公开仓库的JSON任何人都能读取。
2. 在GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens创建令牌，仅选这个数据仓库，Repository permissions中的Contents设为Read and write。设置合适有效期。
3. 在网页「个人设置」下方找到「GitHub个人JSON同步」。填写用户名、数据仓库、分支 `main`、路径 `personal-data.json` 和令牌，点「保存连接配置」。令牌直接在网页填写，不要发送到聊天、写进代码或提交仓库。
4. 在保存了完整个人数据的设备上，先导出完整JSON备份，再点「首次上传本机数据」。若该文件已存在，首次上传会停止，避免覆盖。
5. 在手机或另一台电脑配置同一数据仓库和文件，点「从GitHub加载」。

## 每日使用

- 打开网页后点「从GitHub加载」，获取最新版本。
- 编辑数据后点页面上方「保存到GitHub」。这是手动保存，不是自动保存；未保存时页面会提示，关闭前请保存或导出。
- 切换设备前先保存，另一端再加载。浏览器未保存修改不会自动跨端传递。
- 同时修改时，系统根据文件SHA拒绝覆盖旧版本。遇到冲突先导出本页修改，再加载云端，核对后重新修改并保存。

## 数据与凭据

启用GitHub模式后，业务数据改动仅在页面内存，点击保存才写入GitHub，不再更新浏览器原有个人数据副本。旧本地副本保留作首次迁移备份；仓库地址配置保存在当前浏览器，访问令牌仅保存在当前标签页的sessionStorage，不进入个人JSON和导出备份。关闭会话后可能需要重新填写令牌。

没有配置GitHub的设备仍使用原本的本地模式。不同网址（本地文件、localhost、GitHub Pages）需要分别配置；使用同一GitHub数据文件后可读取同一份个人数据。

无网络、权限不足或写入失败时会提示；不要在失败后直接关闭页面，应重试或导出。云端JSON导入前会校验，坏文件不会替换当前数据。当前单文件上限20MB，长期积累超过上限需导出归档。

GitHub Contents API说明：https://docs.github.com/en/rest/repos/contents
令牌说明：https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
