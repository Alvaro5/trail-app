import { describe, it, expect } from "vitest";
import { minettiCost } from "./pacing";

describe("minettiCost", () => {
  // The seven anchor values verified against Minetti et al. (2002).
  // If a coefficient is ever mistyped, these fail loudly instead of
  // silently shifting every projected pace.
  const anchors: [grade: number, cost: number][] = [
    [-0.45, 4.03],
    [-0.2, 1.8],
    [-0.1, 2.15],
    [0, 3.6],
    [0.1, 5.97],
    [0.2, 9.01],
    [0.45, 19.43],
  ];

  for (const [grade, cost] of anchors) {
    it(`cost at gradient ${grade} ≈ ${cost}`, () => {
      expect(minettiCost(grade)).toBeCloseTo(cost, 2);
    });
  }

  it("clamps gradients beyond ±0.45 to the validated range", () => {
    expect(minettiCost(54)).toBeCloseTo(minettiCost(0.45), 5);
    expect(minettiCost(-54)).toBeCloseTo(minettiCost(-0.45), 5);
  });
});
