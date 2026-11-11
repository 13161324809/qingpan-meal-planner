importScripts("vendor/solver.js", "core.js");
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      result: MealCore.solve(
        data.rows,
        data.target,
        data.meals,
        data.variant,
        solver,
      ),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
