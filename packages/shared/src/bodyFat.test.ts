import { describe, expect, it } from "vitest";
import { navyBodyFatPct, bodyFatFromEntry } from "./bodyFat.js";

describe("navyBodyFatPct", () => {
  it("computes the male happy path", () => {
    // height 70in, neck 15in, waist 33in -> waist-neck diff of 18in
    expect(navyBodyFatPct({ sex: "male", heightIn: 70, neckIn: 15, waistIn: 33 })).toBeCloseTo(15.5, 1);
  });

  it("computes the female happy path", () => {
    // height 64in, neck 12in, waist 28in, hips 36in
    expect(
      navyBodyFatPct({ sex: "female", heightIn: 64, neckIn: 12, waistIn: 28, hipsIn: 36 })
    ).toBeCloseTo(25.2, 1);
  });

  it("returns null when height is zero or negative", () => {
    expect(navyBodyFatPct({ sex: "male", heightIn: 0, neckIn: 15, waistIn: 34 })).toBeNull();
    expect(navyBodyFatPct({ sex: "male", heightIn: -70, neckIn: 15, waistIn: 34 })).toBeNull();
  });

  it("returns null for males when waist - neck is at or below zero (log10 domain)", () => {
    expect(navyBodyFatPct({ sex: "male", heightIn: 70, neckIn: 15, waistIn: 15 })).toBeNull();
    expect(navyBodyFatPct({ sex: "male", heightIn: 70, neckIn: 15, waistIn: 14 })).toBeNull();
  });

  it("returns null for females missing hips", () => {
    expect(navyBodyFatPct({ sex: "female", heightIn: 64, neckIn: 12, waistIn: 28 })).toBeNull();
  });

  it("returns null for females when waist + hips - neck is at or below zero", () => {
    expect(
      navyBodyFatPct({ sex: "female", heightIn: 64, neckIn: 40, waistIn: 10, hipsIn: 10 })
    ).toBeNull();
  });

  it("returns null for missing or NaN inputs", () => {
    expect(
      navyBodyFatPct({ sex: "male", heightIn: 70, neckIn: NaN, waistIn: 34 })
    ).toBeNull();
    expect(
      navyBodyFatPct({ sex: "male", heightIn: NaN, neckIn: 15, waistIn: 34 })
    ).toBeNull();
  });

  it("returns null for a non-finite or negative result", () => {
    // Small waist-neck diff combined with a large height pushes the result negative.
    expect(
      navyBodyFatPct({ sex: "male", heightIn: 96, neckIn: 15, waistIn: 15.1 })
    ).toBeNull();
  });

  it("returns null for non-finite waist input", () => {
    expect(navyBodyFatPct({ sex: "male", heightIn: 70, neckIn: 15, waistIn: Infinity })).toBeNull();
  });

  it("returns null for non-finite hips input on female", () => {
    expect(
      navyBodyFatPct({ sex: "female", heightIn: 64, neckIn: 12, waistIn: 28, hipsIn: Infinity })
    ).toBeNull();
  });
});

describe("bodyFatFromEntry", () => {
  it("computes from a complete profile and entry", () => {
    const result = bodyFatFromEntry(
      { heightIn: 70, sex: "male" },
      { neckIn: 15, waistIn: 33 }
    );
    expect(result).toBeCloseTo(15.5, 1);
  });

  it("computes the female happy path from profile + entry", () => {
    const result = bodyFatFromEntry(
      { heightIn: 64, sex: "female" },
      { neckIn: 12, waistIn: 28, hipsIn: 36 }
    );
    expect(result).toBeCloseTo(25.2, 1);
  });

  it("returns null when the profile is missing height or sex", () => {
    expect(bodyFatFromEntry({ sex: "male" }, { neckIn: 15, waistIn: 33 })).toBeNull();
    expect(bodyFatFromEntry({ heightIn: 70 }, { neckIn: 15, waistIn: 33 })).toBeNull();
    expect(bodyFatFromEntry({}, { neckIn: 15, waistIn: 33 })).toBeNull();
  });

  it("returns null when the entry is missing required measurements", () => {
    expect(bodyFatFromEntry({ heightIn: 70, sex: "male" }, { waistIn: 33 })).toBeNull();
    expect(bodyFatFromEntry({ heightIn: 70, sex: "male" }, { neckIn: 15 })).toBeNull();
  });

  it("returns null for a female entry missing hips", () => {
    expect(
      bodyFatFromEntry({ heightIn: 64, sex: "female" }, { neckIn: 12, waistIn: 28 })
    ).toBeNull();
  });
});
