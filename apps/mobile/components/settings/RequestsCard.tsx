import { StyleSheet, Text, View } from "react-native";
import { describeScheduleMoveError, type ChangeRequest } from "@momentum/shared";
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
  if (request.status === "cancelled") return "Withdrawn";
  if (request.status === "skipped") {
    return request.skip_reason
      ? `Not applied · ${describeScheduleMoveError(request.skip_reason)}`
      : "Not applied";
  }
  // C8: say whether a person looked at it.
  if (request.status === "accepted" && request.auto_applied) return "Moved automatically";
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
 * Read-only history of this client's own change_requests (one row per moved
 * workout), most recent 5. No accept/reject controls — that's a coach-side
 * action via decide_schedule_moves; the client files moves from the
 * reschedule screen and watches their status here.
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
                    (request.status === "rejected" || request.status === "skipped") && styles.itemStatusBad,
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
