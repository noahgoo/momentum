import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react-native";
import { colors, fonts, radii, shadows, spacing } from "../../theme/tokens";
import {
  buildMonthGrid,
  initialMonthKey,
  isWithinRange,
  monthHasSelectableDay,
  monthKeyOf,
  monthLabel,
  shiftMonth,
} from "./calendarMonth";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

interface DatePickerFieldProps {
  /** YYYY-MM-DD, or "" when nothing is chosen yet. */
  value: string;
  minDate: string;
  maxDate: string;
  /** A day inside the window that still cannot be chosen — the date the
   *  workout is already on, which would make the request a no-op. */
  excludeDate?: string;
  placeholder: string;
  onChange: (value: string) => void;
}

/** "2026-10-05" -> "Mon, Oct 5" — built at midday so it cannot slip a day. */
function fieldLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * A month calendar for picking a date inside a fixed window.
 *
 * Replaces a free-text "YYYY-MM-DD" field, which asked the client to know the
 * format, type it without error, and work out for themselves which dates their
 * program actually allows.
 *
 * Built rather than pulled in: a native picker hands back a JS Date in the
 * DEVICE's timezone, and every date in this app is a wall-clock day in the
 * CLIENT's (rule C1). Converting between the two is the bug this avoids
 * entirely — the calendar never leaves YYYY-MM-DD.
 *
 * Days outside [minDate, maxDate] render disabled rather than being hidden, so
 * the shape of the allowed window stays visible.
 */
export function DatePickerField({
  value,
  minDate,
  maxDate,
  excludeDate,
  placeholder,
  onChange,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [monthKey, setMonthKey] = useState(() => initialMonthKey(value, minDate));

  const cells = buildMonthGrid(monthKey);
  const canGoBack = monthHasSelectableDay(shiftMonth(monthKey, -1), minDate, maxDate);
  const canGoForward = monthHasSelectableDay(shiftMonth(monthKey, 1), minDate, maxDate);

  function openPicker() {
    // Reopen on the chosen day's month, not wherever it was left last time.
    setMonthKey(initialMonthKey(value, minDate));
    setOpen(true);
  }

  return (
    <>
      <Pressable
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={placeholder}
        accessibilityValue={{ text: value ? fieldLabel(value) : "No date chosen" }}
        style={({ pressed }) => [styles.field, pressed && styles.fieldPressed]}
      >
        <Text style={[styles.fieldValue, !value && styles.fieldPlaceholder]}>
          {value ? fieldLabel(value) : placeholder}
        </Text>
        <ChevronDown color={colors.ink50} size={16} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* Stops a tap inside the sheet from closing it. */}
          <Pressable style={[styles.sheet, shadows.card]} onPress={() => {}}>
            <View style={styles.monthRow}>
              <Pressable
                onPress={() => setMonthKey(shiftMonth(monthKey, -1))}
                disabled={!canGoBack}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Previous month"
                style={styles.monthNav}
              >
                <ChevronLeft color={canGoBack ? colors.ink : colors.ink30} size={18} />
              </Pressable>

              <Text style={styles.monthLabel}>{monthLabel(monthKey)}</Text>

              <Pressable
                onPress={() => setMonthKey(shiftMonth(monthKey, 1))}
                disabled={!canGoForward}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Next month"
                style={styles.monthNav}
              >
                <ChevronRight color={canGoForward ? colors.ink : colors.ink30} size={18} />
              </Pressable>
            </View>

            <View style={styles.weekdayRow}>
              {WEEKDAYS.map((letter, i) => (
                <Text key={i} style={styles.weekday}>
                  {letter}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {cells.map((date, i) => {
                if (!date) return <View key={`pad-${i}`} style={styles.cell} />;
                const selectable = isWithinRange(date, minDate, maxDate) && date !== excludeDate;
                const selected = date === value;
                return (
                  <Pressable
                    key={date}
                    disabled={!selectable}
                    onPress={() => {
                      onChange(date);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: !selectable }}
                    accessibilityLabel={fieldLabel(date)}
                    style={styles.cell}
                  >
                    <View style={[styles.day, selected && styles.daySelected]}>
                      <Text
                        style={[
                          styles.dayText,
                          !selectable && styles.dayTextDisabled,
                          selected && styles.dayTextSelected,
                        ]}
                      >
                        {Number(date.slice(8, 10))}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
  },
  fieldPressed: {
    backgroundColor: colors.cream,
  },
  fieldValue: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.ink,
  },
  fieldPlaceholder: {
    fontFamily: fonts.body,
    color: colors.ink30,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(28,28,28,0.35)",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
  },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  monthNav: {
    padding: spacing.xs,
  },
  monthLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.ink,
  },
  weekdayRow: {
    flexDirection: "row",
    marginTop: spacing.md,
  },
  weekday: {
    // Same basis as a day cell, so the letters line up over their columns.
    flexBasis: `${100 / 7}%`,
    textAlign: "center",
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    color: colors.ink30,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: spacing.xs,
  },
  cell: {
    flexBasis: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  day: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  daySelected: {
    backgroundColor: colors.ink,
  },
  dayText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.ink,
  },
  dayTextDisabled: {
    color: colors.ink30,
  },
  dayTextSelected: {
    color: colors.cream,
  },
});
