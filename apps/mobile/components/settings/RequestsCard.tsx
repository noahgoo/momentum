import { StyleSheet, Text, View } from "react-native";
import type { ChangeRequest } from "@momentum/shared";
import { colors, fonts, spacing } from "../../theme/tokens";
import { SettingsCard } from "./SettingsCard";

interface RequestsCardProps {
  requests: ChangeRequest[];
  loading: boolean;
}

function formatDate(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function statusLabel(request: ChangeRequest): string {
  if (request.status === "pending") return "Waiting on coach";
  const respondedOn = request.responded_at
    ? new Date(request.responded_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : null;
  const verb = request.status === "accepted" ? "Accepted" : "Declined";
  return respondedOn ? `${verb} ${respondedOn}` : verb;
}

/**
 * Read-only history of this client's own change_requests (workout-move
 * requests, plan finding #3), most recent 5. No accept/reject controls —
 * that's a coach-side action via SECURITY DEFINER RPCs; the client only
 * ever creates a request (MoveWorkoutCard) and watches its status here.
 */
export function RequestsCard({ requests, loading }: RequestsCardProps) {
  return (
    <SettingsCard label="Move requests">
      {loading ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : requests.length === 0 ? (
        <Text style={styles.empty}>No move requests yet.</Text>
      ) : (
        <View style={styles.list}>
          {requests.map((request, index) => (
            <View
              key={request.id}
              style={[styles.item, index > 0 && styles.itemDivider]}
            >
              <View style={styles.itemText}>
                <Text style={styles.itemDates}>
                  {formatDate(request.from_date)} → {formatDate(request.to_date)}
                </Text>
                <Text
                  style={[
                    styles.itemStatus,
                    request.status === "accepted" && styles.itemStatusOk,
                    request.status === "rejected" && styles.itemStatusBad,
                  ]}
                >
                  {statusLabel(request)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  empty: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink50,
  },
  list: {
    gap: 0,
  },
  item: {
    paddingVertical: spacing.sm,
  },
  itemDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.ink08,
  },
  itemText: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  itemDates: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.ink,
  },
  itemStatus: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.warn,
  },
  itemStatusOk: {
    color: colors.ok,
  },
  itemStatusBad: {
    color: colors.bad,
  },
});
