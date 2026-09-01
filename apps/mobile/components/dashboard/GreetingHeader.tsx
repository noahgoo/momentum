import { StyleSheet, Text, View } from "react-native";
import { colors, fonts } from "../../theme/tokens";

interface GreetingHeaderProps {
  firstName: string;
}

function timeAwareGreeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function todayLabel(): string {
  return new Date()
    .toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    .toUpperCase();
}

/**
 * Ports the old dashboard's header (mindful-miya/src/app/dashboard/page.tsx):
 * large Fraunces "Hi, {firstName}" plus a time-aware variant line and an
 * uppercase date label.
 */
export function GreetingHeader({ firstName }: GreetingHeaderProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.greetingLine}>{timeAwareGreeting(new Date().getHours())}</Text>
      <Text style={styles.title}>
        Hi, <Text style={styles.titleName}>{firstName}</Text>
      </Text>
      <Text style={styles.date}>{todayLabel()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 4,
  },
  greetingLine: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.ink50,
    letterSpacing: 0.4,
  },
  title: {
    fontFamily: fonts.displayRegular,
    fontSize: 40,
    lineHeight: 42,
    color: colors.ink,
    letterSpacing: -0.5,
    marginTop: 2,
  },
  titleName: {
    fontFamily: fonts.display,
  },
  date: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.ink50,
    marginTop: 8,
    letterSpacing: 1.1,
  },
});
