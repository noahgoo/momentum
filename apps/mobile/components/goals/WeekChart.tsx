import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, spacing } from "../../theme/tokens";

export interface DayBar {
  date: string; // YYYY-MM-DD
  dayLetter: string;
  done: number;
  total: number;
  isToday: boolean;
}

interface WeekChartProps {
  days: DayBar[];
  selectedDay: string | null;
  onSelectDay: (date: string) => void;
}

const BAR_HEIGHT = 44;

/** 7-day vertical bar chart, one bar per day, filled by that day's completion fraction. */
export function WeekChart({ days, selectedDay, onSelectDay }: WeekChartProps) {
  return (
    <View style={styles.row}>
      {days.map((day) => {
        const fillPct = day.total > 0 ? (day.done / day.total) * 100 : 0;
        const isSelected = day.date === selectedDay;
        return (
          <Pressable
            key={day.date}
            style={styles.col}
            onPress={() => onSelectDay(day.date)}
            hitSlop={4}
          >
            <View
              style={[
                styles.bar,
                {
                  borderColor: isSelected ? colors.ink : day.isToday ? colors.blueDeep : colors.line,
                },
              ]}
            >
              <View
                style={[
                  styles.fill,
                  {
                    height: `${fillPct}%`,
                    backgroundColor: day.isToday ? colors.blueDeep : colors.blue,
                  },
                ]}
              />
            </View>
            <Text
              style={[
                styles.label,
                isSelected ? styles.labelSelected : day.isToday ? styles.labelToday : undefined,
              ]}
            >
              {day.dayLetter}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.sm - 2,
    marginTop: spacing.sm + 2,
  },
  col: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  bar: {
    width: "100%",
    height: BAR_HEIGHT,
    borderRadius: 6,
    borderWidth: 1,
    backgroundColor: colors.paper,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  fill: {
    width: "100%",
  },
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 9,
    color: colors.ink50,
  },
  labelToday: {
    color: colors.blueDeep,
  },
  labelSelected: {
    color: colors.ink,
    fontWeight: "700",
  },
});
