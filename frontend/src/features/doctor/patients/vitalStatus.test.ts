import {
  bloodPressureLevel,
  bmi,
  bmiLevel,
  heartRateLevel,
  respRateLevel,
  spo2Level,
  temperatureLevel,
} from "./vitalStatus";

test("heart rate: 60–100 is normal, the band around it borderline", () => {
  expect([59, 60, 100, 101].map(heartRateLevel)).toEqual(["borderline", "normal", "normal", "borderline"]);
  expect([49, 111].map(heartRateLevel)).toEqual(["abnormal", "abnormal"]);
});

test("blood pressure: below 130/80 normal; 148/92 (the design's example) abnormal; low is abnormal", () => {
  expect(bloodPressureLevel(120, 78)).toBe("normal");
  expect(bloodPressureLevel(135, 85)).toBe("borderline");
  expect(bloodPressureLevel(148, 92)).toBe("abnormal");
  expect(bloodPressureLevel(85, 55)).toBe("abnormal");
});

test("SpO₂, breathing rate and temperature", () => {
  expect([98, 93, 90].map(spo2Level)).toEqual(["normal", "borderline", "abnormal"]);
  expect([18, 22, 30].map(respRateLevel)).toEqual(["normal", "borderline", "abnormal"]);
  expect([36.8, 37.6, 39].map(temperatureLevel)).toEqual(["normal", "borderline", "abnormal"]);
});

test("BMI is computed from height and weight and judged against 18.5–24.9", () => {
  expect(bmi(176, 84)).toBeCloseTo(27.1, 1); // the design's example
  expect([22, 27.1, 35, 16].map(bmiLevel)).toEqual(["normal", "borderline", "abnormal", "abnormal"]);
});
