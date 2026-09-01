import { describe, expect, it } from "vitest";
import {
  bodyMeasurementCreateSchema,
  changeRequestCreateSchema,
  friendRequestCreateSchema,
  goalCreateSchema,
  messageSendSchema,
  profileSettingsUpdateSchema,
  programCreateSchema,
  setConfigSchema,
  workoutCreateSchema,
  workoutExerciseInputSchema,
} from "./schemas.js";

describe("profileSettingsUpdateSchema", () => {
  it("accepts a valid full payload", () => {
    const result = profileSettingsUpdateSchema.safeParse({
      displayName: "Jamie",
      notificationTime: "07:30",
      notificationsEnabled: true,
      heightIn: 68,
      sex: "female",
      timezone: "America/New_York",
    });
    expect(result.success).toBe(true);
  });

  it("accepts without optional heightIn/sex", () => {
    const result = profileSettingsUpdateSchema.safeParse({
      displayName: "Jamie",
      notificationTime: "07:30",
      notificationsEnabled: true,
      timezone: "UTC",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty displayName", () => {
    const result = profileSettingsUpdateSchema.safeParse({
      displayName: "",
      notificationTime: "07:30",
      notificationsEnabled: true,
      timezone: "UTC",
    });
    expect(result.success).toBe(false);
  });

  it("rejects displayName over 80 chars", () => {
    const result = profileSettingsUpdateSchema.safeParse({
      displayName: "a".repeat(81),
      notificationTime: "07:30",
      notificationsEnabled: true,
      timezone: "UTC",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed notificationTime", () => {
    const result = profileSettingsUpdateSchema.safeParse({
      displayName: "Jamie",
      notificationTime: "7:30",
      notificationsEnabled: true,
      timezone: "UTC",
    });
    expect(result.success).toBe(false);
  });

  it("rejects notificationTime with an out-of-range hour", () => {
    const result = profileSettingsUpdateSchema.safeParse({
      displayName: "Jamie",
      notificationTime: "24:00",
      notificationsEnabled: true,
      timezone: "UTC",
    });
    expect(result.success).toBe(false);
  });

  it("rejects heightIn out of bounds", () => {
    const tooShort = profileSettingsUpdateSchema.safeParse({
      displayName: "Jamie",
      notificationTime: "07:30",
      notificationsEnabled: true,
      heightIn: 19,
      timezone: "UTC",
    });
    const tooTall = profileSettingsUpdateSchema.safeParse({
      displayName: "Jamie",
      notificationTime: "07:30",
      notificationsEnabled: true,
      heightIn: 97,
      timezone: "UTC",
    });
    expect(tooShort.success).toBe(false);
    expect(tooTall.success).toBe(false);
  });

  it("rejects an empty timezone", () => {
    const result = profileSettingsUpdateSchema.safeParse({
      displayName: "Jamie",
      notificationTime: "07:30",
      notificationsEnabled: true,
      timezone: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-IANA-looking timezone", () => {
    const result = profileSettingsUpdateSchema.safeParse({
      displayName: "Jamie",
      notificationTime: "07:30",
      notificationsEnabled: true,
      timezone: "EST",
    });
    expect(result.success).toBe(false);
  });
});

describe("goalCreateSchema", () => {
  it("accepts valid goal text", () => {
    expect(goalCreateSchema.safeParse({ text: "Drink more water" }).success).toBe(true);
  });

  it("rejects empty text", () => {
    expect(goalCreateSchema.safeParse({ text: "" }).success).toBe(false);
  });

  it("rejects text over 200 chars", () => {
    expect(goalCreateSchema.safeParse({ text: "a".repeat(201) }).success).toBe(false);
  });

  it("accepts text at the 200 char boundary", () => {
    expect(goalCreateSchema.safeParse({ text: "a".repeat(200) }).success).toBe(true);
  });
});

describe("messageSendSchema", () => {
  it("accepts valid message text", () => {
    expect(messageSendSchema.safeParse({ text: "Hey, great job today!" }).success).toBe(true);
  });

  it("trims and rejects whitespace-only text", () => {
    expect(messageSendSchema.safeParse({ text: "   " }).success).toBe(false);
  });

  it("rejects text over 2000 chars", () => {
    expect(messageSendSchema.safeParse({ text: "a".repeat(2001) }).success).toBe(false);
  });

  it("trims surrounding whitespace on success", () => {
    const result = messageSendSchema.safeParse({ text: "  hello  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.text).toBe("hello");
  });
});

describe("changeRequestCreateSchema", () => {
  it("accepts valid differing dates", () => {
    const result = changeRequestCreateSchema.safeParse({
      fromDate: "2026-09-01",
      toDate: "2026-09-03",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed date format", () => {
    const result = changeRequestCreateSchema.safeParse({
      fromDate: "09/01/2026",
      toDate: "2026-09-03",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when fromDate === toDate (refine)", () => {
    const result = changeRequestCreateSchema.safeParse({
      fromDate: "2026-09-01",
      toDate: "2026-09-01",
    });
    expect(result.success).toBe(false);
  });
});

describe("setConfigSchema", () => {
  it("accepts a valid reps/weight set", () => {
    const result = setConfigSchema.safeParse({ reps: 10, weight: 135, weightUnit: "lbs" });
    expect(result.success).toBe(true);
  });

  it("accepts an empty object (all optional)", () => {
    expect(setConfigSchema.safeParse({}).success).toBe(true);
  });

  it("rejects a negative weight", () => {
    expect(setConfigSchema.safeParse({ weight: -5 }).success).toBe(false);
  });

  it("rejects a non-integer reps value", () => {
    expect(setConfigSchema.safeParse({ reps: 10.5 }).success).toBe(false);
  });

  it("rejects a zero/negative seconds value", () => {
    expect(setConfigSchema.safeParse({ seconds: 0 }).success).toBe(false);
    expect(setConfigSchema.safeParse({ seconds: -30 }).success).toBe(false);
  });
});

describe("workoutExerciseInputSchema", () => {
  const base = {
    mode: "reps" as const,
    setConfigs: [{ reps: 10 }],
  };

  it("accepts a valid minimal payload", () => {
    expect(workoutExerciseInputSchema.safeParse(base).success).toBe(true);
  });

  it("rejects an empty setConfigs array (min 1)", () => {
    expect(
      workoutExerciseInputSchema.safeParse({ ...base, setConfigs: [] }).success
    ).toBe(false);
  });

  it("rejects setConfigs over 20 entries", () => {
    expect(
      workoutExerciseInputSchema.safeParse({
        ...base,
        setConfigs: Array.from({ length: 21 }, () => ({ reps: 10 })),
      }).success
    ).toBe(false);
  });

  it("rejects restSeconds above 900", () => {
    expect(
      workoutExerciseInputSchema.safeParse({ ...base, restSeconds: 901 }).success
    ).toBe(false);
  });

  it("accepts restSeconds at the 0 boundary", () => {
    expect(
      workoutExerciseInputSchema.safeParse({ ...base, restSeconds: 0 }).success
    ).toBe(true);
  });

  it("rejects notes over 500 chars", () => {
    expect(
      workoutExerciseInputSchema.safeParse({ ...base, notes: "a".repeat(501) }).success
    ).toBe(false);
  });
});

describe("workoutCreateSchema", () => {
  const base = { name: "Leg Day", type: "workout" as const };

  it("accepts a valid minimal payload", () => {
    expect(workoutCreateSchema.safeParse(base).success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(workoutCreateSchema.safeParse({ ...base, name: "" }).success).toBe(false);
  });

  it("rejects name over 80 chars", () => {
    expect(
      workoutCreateSchema.safeParse({ ...base, name: "a".repeat(81) }).success
    ).toBe(false);
  });

  it("rejects estimatedDurationMinutes above 300", () => {
    expect(
      workoutCreateSchema.safeParse({ ...base, estimatedDurationMinutes: 301 }).success
    ).toBe(false);
  });

  it("rejects estimatedDurationMinutes of 0 (min 1)", () => {
    expect(
      workoutCreateSchema.safeParse({ ...base, estimatedDurationMinutes: 0 }).success
    ).toBe(false);
  });

  it("rejects equipment array over 20 entries", () => {
    expect(
      workoutCreateSchema.safeParse({
        ...base,
        equipment: Array.from({ length: 21 }, (_, i) => `item-${i}`),
      }).success
    ).toBe(false);
  });

  it("rejects an invalid type enum value", () => {
    expect(
      workoutCreateSchema.safeParse({ ...base, type: "cardio" }).success
    ).toBe(false);
  });
});

describe("programCreateSchema", () => {
  it("accepts a valid minimal payload", () => {
    expect(programCreateSchema.safeParse({ name: "Strength Base", weeks: 8 }).success).toBe(
      true
    );
  });

  it("rejects weeks of 0 (min 1)", () => {
    expect(programCreateSchema.safeParse({ name: "Strength Base", weeks: 0 }).success).toBe(
      false
    );
  });

  it("rejects weeks over 52", () => {
    expect(programCreateSchema.safeParse({ name: "Strength Base", weeks: 53 }).success).toBe(
      false
    );
  });

  it("accepts valid phases with activeDays", () => {
    const result = programCreateSchema.safeParse({
      name: "Strength Base",
      weeks: 8,
      phases: [{ name: "Phase 1", weeks: 4, activeDays: ["monday", "wednesday", "friday"] }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a phase with weeks below 1", () => {
    const result = programCreateSchema.safeParse({
      name: "Strength Base",
      weeks: 8,
      phases: [{ weeks: 0, activeDays: ["monday"] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a phase with an invalid day-of-week value", () => {
    const result = programCreateSchema.safeParse({
      name: "Strength Base",
      weeks: 8,
      phases: [{ weeks: 4, activeDays: ["funday"] }],
    });
    expect(result.success).toBe(false);
  });
});

describe("bodyMeasurementCreateSchema", () => {
  it("accepts a valid full payload", () => {
    const result = bodyMeasurementCreateSchema.safeParse({
      date: "2026-08-31",
      weightLbs: 180,
      waistIn: 34,
      neckIn: 15,
      hipsIn: 38,
    });
    expect(result.success).toBe(true);
  });

  it("accepts date-only payload (all measurements optional)", () => {
    expect(bodyMeasurementCreateSchema.safeParse({ date: "2026-08-31" }).success).toBe(true);
  });

  it("rejects a malformed date", () => {
    expect(
      bodyMeasurementCreateSchema.safeParse({ date: "08-31-2026" }).success
    ).toBe(false);
  });

  it("rejects a negative measurement", () => {
    expect(
      bodyMeasurementCreateSchema.safeParse({ date: "2026-08-31", waistIn: -1 }).success
    ).toBe(false);
  });

  it("rejects weightLbs below the 50 floor", () => {
    expect(
      bodyMeasurementCreateSchema.safeParse({ date: "2026-08-31", weightLbs: 49 }).success
    ).toBe(false);
  });

  it("rejects weightLbs above the 1000 cap", () => {
    expect(
      bodyMeasurementCreateSchema.safeParse({ date: "2026-08-31", weightLbs: 1001 }).success
    ).toBe(false);
  });

  it("rejects a non-finite measurement", () => {
    expect(
      bodyMeasurementCreateSchema.safeParse({ date: "2026-08-31", waistIn: Infinity }).success
    ).toBe(false);
  });
});

describe("friendRequestCreateSchema", () => {
  it("accepts a valid uuid", () => {
    expect(
      friendRequestCreateSchema.safeParse({ friendId: "123e4567-e89b-12d3-a456-426614174000" })
        .success
    ).toBe(true);
  });

  it("rejects a non-uuid string", () => {
    expect(friendRequestCreateSchema.safeParse({ friendId: "not-a-uuid" }).success).toBe(
      false
    );
  });
});
