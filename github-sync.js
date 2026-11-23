/* Personal JSON storage via GitHub Contents API. No business data is cached here. */
(function (root) {
  "use strict";
  function config(value) {
    const c = {owner:String(value.owner || "").trim(), repo:String(value.repo || "").trim(), branch:String(value.branch || "main").trim(), path:String(value.path || "personal-data.json").trim()};
    if (![c.owner,c.repo].every(v => /^[A-Za-z0-9_.-]+$/.test(v)) || !c.branch || /\s/.test(c.branch)) throw Error("请填写有效的GitHub用户名、仓库和分支");
    if (!c.path.endsWith(".json") || c.path.startsWith("/") || c.path.split("/").some(v => !v || v === "." || v === "..") || /[?#\\]/.test(c.path)) throw Error("数据路径应为仓库内的JSON文件，例如personal-data.json");
    return c;
  }
  const encode = text => root.btoa(encodeURIComponent(text).replace(/%([0-9A-F]{2})/g,(_,hex) => String.fromCharCode(parseInt(hex,16))));
  const decode = text => decodeURIComponent(Array.from(root.atob(text.replace(/\s/g,"")), c => "%" + c.charCodeAt(0).toString(16).padStart(2,"0")).join(""));
  class Store {
    constructor(settings, token, validate, fetcher = root.fetch?.bind(root)) {
      this.config = config(settings); this.token = token; this.validate = validate; this.fetch = fetcher; this.sha = null;
      if (!token?.trim()) throw Error("请填写当前会话的GitHub访问令牌");
      const c = this.config;
      this.url = "https://api.github.com/repos/" + encodeURIComponent(c.owner) + "/" + encodeURIComponent(c.repo) + "/contents/" + c.path.split("/").map(encodeURIComponent).join("/");
    }
    async request(method, body, raw = false, url = this.url) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(),20000);
      try {
        const response = await this.fetch(url + (method === "GET" && url === this.url ? "?ref=" + encodeURIComponent(this.config.branch) : ""), {
          method, cache:"no-store", signal:controller.signal,
          headers:{Accept:raw ? "application/vnd.github.raw+json" : method === "GET" ? "application/vnd.github.object+json" : "application/vnd.github+json", Authorization:"Bearer " + this.token, "X-GitHub-Api-Version":"2022-11-28", ...(body ? {"Content-Type":"application/json"} : {})},
          ...(body ? {body:JSON.stringify(body)} : {})
        });
        if (!response.ok) {
          const error = Error(response.status === 409 || response.status === 422 ? "云端版本已变化或写入被拒绝。请先导出本机未保存数据，再加载云端核对；未覆盖云端。" : response.status === 401 || response.status === 403 ? "GitHub认证或权限不足，请检查令牌、有效期和Contents读写权限。" : response.status === 404 ? "找不到仓库、分支或数据文件，也可能是令牌无权访问。" : "GitHub请求失败（" + response.status + "），本机数据仍保留在页面中。");
          error.status = response.status; throw error;
        }
        return raw ? await response.text() : await response.json();
      } catch (error) {
        if (error.name === "AbortError") throw Error("GitHub请求超时，数据未确认保存，请重试或导出备份。");
        throw error;
      } finally { clearTimeout(timer); }
    }
    async load() {
      const file = await this.request("GET");
      if (!file.sha || file.size > 20000000) throw Error("云端文件无效或超过20MB，请导出并归档历史记录。");
      let text;
      if (file.encoding === "base64" && typeof file.content === "string") text = decode(file.content);
      else if (file.encoding === "none" && /^[a-f0-9]{40}$/.test(file.sha))
        text = await this.request("GET",undefined,true,this.url.split("/contents/")[0] + "/git/blobs/" + file.sha);
      else throw Error("云端文件格式不支持，请选择普通JSON文件。");
      let data;
      try { data = JSON.parse(text); } catch { throw Error("云端JSON格式无效，未替换本机数据。"); }
      this.validate(data);
      this.sha = file.sha;
      return data;
    }
    async write(data, create = false) {
      this.validate(data);
      if (!create && !this.sha) throw Error("请先加载云端版本，再保存修改。");
      const content = encode(JSON.stringify(data,null,2));
      if (content.length > 26666668) throw Error("JSON超过20MB，请先导出备份并归档历史记录。");
      const result = await this.request("PUT",{message:"Save Qingpan personal data", content, branch:this.config.branch, ...(!create ? {sha:this.sha} : {})});
      if (!result.content?.sha) throw Error("GitHub未返回文件版本，保存状态未确认，请加载云端核对。");
      this.sha = result.content.sha;
    }
    async create(data) {
      try { await this.load(); } catch (error) { if (error.status === 404) return this.write(data,true); throw error; }
      throw Error("云端已有数据文件，请加载云端；首次上传不会覆盖已有文件。");
    }
    save(data) { return this.write(data); }
  }
  const api = {Store,config,encode,decode};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GithubJsonStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
