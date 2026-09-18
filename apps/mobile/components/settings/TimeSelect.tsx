import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Check, ChevronDown } from "lucide-react-native";
import { colors, fonts, radii, shadows, spacing } from "../../theme/tokens";
import { ROW_HEIGHT, buildSlots } from "./timeSlots";

interface TimeSelectProps {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  accessibilityLabel: string;
}

/**
 * A field showing the chosen time, opening a sheet of the times that can
 * actually be delivered. Replaces 28 separate chips across a horizontal
 * scroller and a second row — which asked the client to assemble a time out of
 * two half-answers, and hid most of the hours off the edge of the card.
 */
export function TimeSelect({ value, disabled, onChange, accessibilityLabel }: TimeSelectProps) {
  const [open, setOpen] = useState(false);
  const slots = useMemo(buildSlots, []);
  const scrollRef = useRef<ScrollView>(null);

  const selectedIndex = Math.max(
    0,
    slots.findIndex((s) => s.value === value)
  );
  const current = slots[selectedIndex] ?? slots[32]!;

  // Open already showing the current value rather than at midnight.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, (selectedIndex - 2) * ROW_HEIGHT),
        animated: false,
      });
    }, 0);
    return () => clearTimeout(t);
  }, [open, selectedIndex]);

  return (
    <>
      <Pressable
        disabled={disabled}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: current.label }}
        style={({ pressed }) => [styles.field, pressed && styles.fieldPressed]}
      >
        <Text style={styles.fieldValue}>{current.label}</Text>
        <ChevronDown color={colors.ink50} size={16} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* Stop a tap inside the sheet from closing it. */}
          <Pressable style={[styles.sheet, shadows.card]} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Reminder time</Text>
            <ScrollView ref={scrollRef} style={styles.list}>
              {slots.map((slot) => {
                const selected = slot.value === current.value;
                return (
                  <Pressable
                    key={slot.value}
                    onPress={() => {
                      if (slot.value !== current.value) onChange(slot.value);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  >
                    <Text style={[styles.rowLabel, selected && styles.rowLabelSelected]}>
                      {slot.label}
                    </Text>
                    {selected && <Check color={colors.ink} size={16} strokeWidth={2.5} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    height: 46,
    paddingHorizontal: spacing.md,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.ink08,
    backgroundColor: colors.cream,
  },
  fieldPressed: {
    backgroundColor: colors.creamDeep,
  },
  fieldValue: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.ink,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(28,28,28,0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    maxHeight: "70%",
  },
  sheetTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.ink50,
    textTransform: "uppercase",
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  list: {
    paddingHorizontal: spacing.md,
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    borderRadius: radii.control,
  },
  rowPressed: {
    backgroundColor: colors.cream,
  },
  rowLabel: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink70,
  },
  rowLabelSelected: {
    fontFamily: fonts.bodySemiBold,
    color: colors.ink,
  },
});
