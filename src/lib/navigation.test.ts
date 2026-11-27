import { describe, expect, it } from "vitest";
import { advanceStep, distanceBetween, distanceToPath, offRouteFixes, shouldRecalculate, navigationDistance, type NavigationStep } from "./navigation";

const steps: NavigationStep[] = [
  { instruction: "Siga pela Rua A", maneuver: "STRAIGHT", distanceMeters: 110, start: { lat: 0, lng: 0 }, end: { lat: 0, lng: 0.001 } },
  { instruction: "Vire à direita na Rua B", maneuver: "TURN_RIGHT", distanceMeters: 110, start: { lat: 0, lng: 0.001 }, end: { lat: 0.001, lng: 0.001 } },
];
const first = steps[0];
const second = steps[1];
if (!first || !second) throw new Error("Missing navigation test fixtures");

describe("Delivery navigation", () => {
  it("keeps the current instruction while away from the turn", () => {
    expect(advanceStep(steps, 0, { lat: 0, lng: 0 })).toBe(0);
  });
  it("advances when GPS reaches the turn", () => {
    expect(advanceStep(steps, 0, { lat: 0, lng: 0.0009 })).toBe(1);
  });
  it("does not jump forward at another step's endpoint", () => {
    expect(advanceStep(steps, 0, second.end)).toBe(0);
  });
  it("marks completion without going beyond the final step", () => {
    expect(advanceStep(steps, 1, second.end)).toBe(2);
    expect(advanceStep(steps, 2, second.end)).toBe(2);
  });
  it("formats approximate distance and calculates GPS distance", () => {
    expect(navigationDistance(117)).toBe("120 m");
    expect(navigationDistance(1520)).toBe("1.5 km");
    expect(distanceBetween(first.start, first.end)).toBeCloseTo(111.195, 2);
  });
});

describe("automatic rerouting", () => {
  const path = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }];
  it("keeps a rider on the street between polyline vertices on route", () => {
    expect(distanceToPath({ lat: 0, lng: 0.005 }, path)).toBe(0);
    expect(offRouteFixes({ lat: 0, lng: 0.005 }, path, 2)).toBe(0);
  });
  it("detects a rider on another street and resets after returning", () => {
    const pos = { lat: 0.001, lng: 0.005 };
    expect(offRouteFixes(pos, path, 0)).toBe(1);
    expect(offRouteFixes(pos, path, 2)).toBe(3);
    expect(offRouteFixes({ lat: 0.0001, lng: 0.005 }, path, 3)).toBe(0);
  });
  it("requires confirmed deviation and throttles duplicate requests", () => {
    expect(shouldRecalculate(2, 30000, 0, false)).toBe(false);
    expect(shouldRecalculate(3, 30000, 0, false)).toBe(true);
    expect(shouldRecalculate(3, 30000, 20000, false)).toBe(false);
    expect(shouldRecalculate(3, 30000, 0, true)).toBe(false);
  });
});