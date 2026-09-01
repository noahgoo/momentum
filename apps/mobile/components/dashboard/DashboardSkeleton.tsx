import { StyleSheet, View } from "react-native";
import { colors, radii, spacing } from "../../theme/tokens";

/** Loading placeholder shown while the dashboard's queries are pending. */
export function DashboardSkeleton() {
  return (
    <View style={styles.container}>
      <View style={styles.headerBlock}>
        <View style={[styles.bar, { width: 160, height: 34 }]} />
        <View style={[styles.bar, { width: 110, height: 12, marginTop: 10 }]} />
      </View>
      <View style={[styles.card, { height: 96 }]} />
      <View style={[styles.card, { height: 150 }]} />
      <View style={styles.row}>
        <View style={[styles.card, { flex: 1, height: 150 }]} />
        <View style={[styles.card, { width: 130, height: 150 }]} />
      </View>
      <View style={[styles.card, { height: 88 }]} />
      <View style={[styles.card, { height: 88 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  headerBlock: {
    paddingBottom: 4,
  },
  bar: {
    backgroundColor: colors.creamDeep,
    borderRadius: 8,
  },
  card: {
    backgroundColor: colors.creamDeep,
    borderRadius: radii.card,
    opacity: 0.6,
  },
  row: {
    flexDirection: "row",
    gap: spacing.md,
  },
});
