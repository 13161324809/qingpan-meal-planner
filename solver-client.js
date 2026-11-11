/* Run every optimization in a disposable worker; never block the page thread. */
(function (root) {
  "use strict";
  function createWorker() {
    if (typeof Worker !== "function")
      throw Error("此浏览器不支持后台计算，请使用新版 Chrome 或 Edge");
    if (typeof root.QingpanSolverWorkerSource === "string") {
      const url = URL.createObjectURL(
        new Blob([root.QingpanSolverWorkerSource], { type: "text/javascript" }),
      );
      try {
        return {
          worker: new Worker(url),
          dispose: () => URL.revokeObjectURL(url),
        };
      } catch (e) {
        URL.revokeObjectURL(url);
        throw e;
      }
    }
    if (typeof location !== "undefined" && location.protocol === "file:")
      throw Error("离线求解文件缺失，请保留 solver-worker-source.js 后重新打开网页");
    return { worker: new Worker("worker.js") };
  }
  function createJob(input, options = {}) {
    const factory = options.createWorker || createWorker;
    const timeoutMs = options.timeoutMs ?? 4500;
    const progress = options.onProgress || (() => {});
    let cancelled = false,
      abortCurrent = null;
    const cancelledError = () =>
      Object.assign(Error("已取消计算，原计划未修改"), { code: "CANCELLED" });
    const failure = (variant, message) => ({
      variant,
      rows: [],
      issues: [message],
      valid: false,
    });
    function solveOne(variant) {
      return new Promise((resolve, reject) => {
        let handle,
          worker,
          timer,
          settled = false;
        function finish(result, error) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          abortCurrent = null;
          if (worker) {
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            worker.terminate();
          }
          handle?.dispose?.();
          if (error) reject(error);
          else resolve(result);
        }
        try {
          handle = factory();
          worker = handle.worker || handle;
          abortCurrent = () => finish(null, cancelledError());
          timer = setTimeout(
            () =>
              finish(
                failure(
                  variant,
                  `方案${variant}超过${timeoutMs / 1000}秒，已停止该后台计算；可调整范围后重试，其他方案仍会继续。`,
                ),
              ),
            timeoutMs,
          );
          worker.onmessage = ({ data }) => {
            if (data.error) finish(failure(variant, "求解失败：" + data.error));
            else if (
              data.result?.variant === variant &&
              Array.isArray(data.result.rows)
            )
              finish(data.result);
            else finish(failure(variant, "后台计算返回格式无效，请重试"));
          };
          worker.onerror = () =>
            finish(
              failure(
                variant,
                "后台计算加载或运行失败，请检查本地文件是否齐全",
              ),
            );
          worker.onmessageerror = () =>
            finish(failure(variant, "后台计算消息读取失败，请重试"));
          worker.postMessage({ ...input, variant });
        } catch (e) {
          finish(failure(variant, e.message));
        }
      });
    }
    const promise = (async () => {
      const results = [];
      for (const variant of ["A", "B", "C"]) {
        if (cancelled) throw cancelledError();
        progress({ variant, completed: results.length, total: 3 });
        let result;
        if (variant === "B" && input.target.enforceSodium !== true)
          result = { ...results[0], variant: "B" };
        else result = await solveOne(variant);
        if (cancelled) throw cancelledError();
        results.push(result);
      }
      return { results };
    })();
    return {
      promise,
      cancel() {
        cancelled = true;
        abortCurrent?.();
      },
    };
  }
  const api = { createJob };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MealSolver = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
