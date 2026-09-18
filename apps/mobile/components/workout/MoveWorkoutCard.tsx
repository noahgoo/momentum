import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Clock3 } from "lucide-react-native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import type { ChangeRequest } from "@momentum/shared";
import {
  useCreateChangeRequest,
  DuplicatePendingRequestError,
} from "../../lib/queries/useChangeRequest";
import { DatePickerField } from "./DatePickerField";

interface MoveWorkoutCardProps {
  clientId: string;
  coachId: string;
  fromDate: string;
  workoutId: string | null;
  minDate: string;
  maxDate: string;
  pendingRequest: ChangeRequest | null | undefined;
}

/**
 * Lets a client ask their coach to move this workout to a different date.
 * Ported from mindful-miya's MoveWorkoutCard.tsx. No cancel action — plan
 * brief explicitly calls out "NO cancel (no delete policy) — show waiting
 * state" once a request is pending.
 *
 * The date used to be a free-text "YYYY-MM-DD" field, which made the client
 * know the format, type it exactly, and work out which dates their program
 * allowed. It is a calendar now (DatePickerField), clamped to the assignment
 * window, and the mutation layer is untouched — it still receives the same
 * string.
 */
export function MoveWorkoutCard({
  clientId,
  coachId,
  fromDate,
  workoutId,
  minDate,
  maxDate,
  pendingRequest,
}: MoveWorkoutCardProps) {
  const [open, setOpen] = useState(false);
  const [toDate, setToDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const createChangeRequest = useCreateChangeRequest();

  if (pendingRequest && pendingRequest.from_date === fromDate) {
    return (
      <View style={styles.pendingCard}>
        <Clock3 color={colors.ink50} size={18} />
        <View style={{ flex: 1 }}>
          <Text style={styles.pendingTitle}>Move requested → {pendingRequest.to_date}</Text>
          <Text style={styles.pendingSubtitle}>Waiting on your coach to approve.</Text>
        </View>
      </View>
    );
  }

  // On the last day of a program the window is [today, today] and the only
  // date in it is the one the workout already sits on. The old text field just
  // left "Send request" disabled with nothing to explain why.
  const hasAlternativeDate = minDate < maxDate || (minDate !== fromDate && minDate <= maxDate);

  if (!hasAlternativeDate) {
    return (
      <Text style={styles.noRoomText}>
        There is no later date left in your program to move this to.
      </Text>
    );
  }

  if (!open) {
    return (
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.linkButton}>
        <Text style={styles.linkButtonText}>Request to move this workout</Text>
      </TouchableOpacity>
    );
  }

  async function handleSubmit() {
    if (!toDate) return;
    setError(null);
    try {
      await createChangeRequest.mutateAsync({
        clientId,
        coachId,
        fromDate,
        toDate,
        workoutId,
      });
      setOpen(false);
      setToDate("");
    } catch (err) {
      if (err instanceof DuplicatePendingRequestError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    }
  }

  const submitting = createChangeRequest.isPending;
  const withinRange =
    toDate.length === 10 && toDate >= minDate && toDate <= maxDate && toDate !== fromDate;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Move this workout</Text>
      <Text style={styles.subtitle}>Pick a new date — your coach will need to approve it.</Text>
      <DatePickerField
        value={toDate}
        minDate={minDate}
        maxDate={maxDate}
        excludeDate={fromDate}
        placeholder="Choose a date"
        onChange={setToDate}
      />
      {error && <Text style={styles.errorText}>{error}</Text>}
      <View style={styles.buttonRow}>
        <TouchableOpacity
          onPress={() => void handleSubmit()}
          disabled={!withinRange || submitting}
          style={[styles.sendButton, !withinRange || submitting ? styles.buttonDisabled : undefined]}
        >
          <Text style={styles.sendButtonText}>{submitting ? "Sending…" : "Send request"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setOpen(false);
            setError(null);
          }}
          style={styles.cancelButton}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    padding: spacing.lg,
  },
  title: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.ink,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    marginTop: 2,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.bad,
    marginTop: spacing.sm,
  },
  buttonRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  sendButton: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: "#fff",
  },
  cancelButton: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButtonText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.ink70,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  noRoomText: {
    marginTop: spacing.lg,
    textAlign: "center",
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.ink50,
  },
  linkButton: {
    marginTop: spacing.lg,
    alignItems: "center",
  },
  linkButtonText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    textDecorationLine: "underline",
  },
  pendingCard: {
    marginTop: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  pendingTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.ink,
  },
  pendingSubtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    marginTop: 2,
  },
});
