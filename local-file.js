/* Authorized local JSON file. Browser storage is not used for file contents. */
(function (root) {
  "use strict";
  class Store {
    constructor(handle, validate) { this.handle = handle; this.validate = validate; this.baseline = null; this.queue = Promise.resolve(); }
    async load() {
      const text = await (await this.handle.getFile()).text();
      let data;
      try { data = JSON.parse(text.replace(/^\uFEFF/,"")); } catch { throw Error("选中的文件不是有效JSON，原数据未替换"); }
      this.validate(data); this.baseline = text;
      return data;
    }
    async create(data) {
      this.validate(data);
      const text = await (await this.handle.getFile()).text();
      if (text.trim()) throw Error("该文件已有内容，请用“打开JSON文件”读取，或选择一个新文件名");
      this.baseline = text;
      await this.save(data);
    }
    save(data) {
      this.validate(data);
      const snapshot = JSON.stringify(data,null,2);
      const write = async () => {
        if (this.baseline === null) throw Error("请先打开或新建JSON文件");
        const current = await (await this.handle.getFile()).text();
        if (current !== this.baseline) throw Error("JSON文件被其他窗口或程序更新，已停止覆盖。请导出本页备份，再重新打开文件核对");
        if (snapshot === current) return;
        let writer;
        try {
          writer = await this.handle.createWritable();
          await writer.write(snapshot);
          await writer.close();
          this.baseline = snapshot;
        } catch (error) {
          try { await writer?.abort(); } catch {}
          throw error;
        }
      };
      this.queue = this.queue.catch(() => {}).then(write);
      return this.queue;
    }
  }
  const api = {Store};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LocalJsonStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
