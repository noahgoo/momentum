import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, fonts, italicOverhang, shadows } from "../../theme/tokens";

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

/** First letter of the display name, or a neutral glyph before it loads. */
function initial(firstName: string): string {
  const letter = firstName.trim().charAt(0);
  return letter ? letter.toUpperCase() : "·";
}

/**
 * Ports the old dashboard's header (mindful-miya/src/app/dashboard/page.tsx):
 * large Fraunces "Hi, {firstName}" plus a time-aware variant line and an
 * uppercase date label.
 *
 * The avatar is the app's ONLY entry to /settings — height, sex, reminder
 * time, timezone and sign out all live there. It previously hung off a text
 * link inside BodyFatHeroCard that renders only while the profile is
 * incomplete, so filling the profile in removed the only way back to the
 * screen (sign out included). A tab was the alternative, but settings is
 * low-frequency and the bar is already at five.
 */
export function GreetingHeader({ firstName }: GreetingHeaderProps) {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.textColumn}>
        <Text style={styles.greetingLine}>{timeAwareGreeting(new Date().getHours())}</Text>
        <Text style={styles.title} numberOfLines={1}>
          Hi, <Text style={styles.titleName}>{firstName}</Text>
        </Text>
        <Text style={styles.date}>{todayLabel()}</Text>
      </View>

      <Pressable
        onPress={() => router.push("/settings")}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Profile and settings"
        style={({ pressed }) => [styles.avatar, shadows.cardSubtle, pressed && styles.avatarPressed]}
      >
        <Text style={styles.avatarInitial}>{initial(firstName)}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 4,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
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
    marginTop: 2,
    // Italic display face: the final glyph leans past its advance width and RN
    // would clip it, more visibly now that the avatar sits alongside. No
    // negative letterSpacing here for the same reason (see tokens).
    paddingRight: italicOverhang(40),
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
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  avatarPressed: {
    backgroundColor: colors.creamDeep,
  },
  avatarInitial: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.ink,
  },
});
