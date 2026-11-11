importScripts("vendor/solver.js", "core.js");
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      results: ["A", "B", "C"].map((v) =>
        MealCore.solve(data.rows, data.target, data.meals, v, solver),
      ),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
