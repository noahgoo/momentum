import { View, StyleSheet, type ColorValue } from "react-native";
import { TopTabs } from "expo-router/js-top-tabs";
import { Home, Dumbbell, Target, TrendingUp, MessageCircle } from "lucide-react-native";
import { colors } from "../../theme/tokens";
import { useAuth } from "../../lib/auth";
import { useHasUnreadMessages } from "../../lib/queries/useUnreadMessages";
import { PillTabBar, type PillTabBarProps } from "../../components/PillTabBar";

type TabIconProps = { color: string; size: number };

/** Small red dot overlaid on the Messages tab icon when there's an unread message. */
function MessagesIcon({ color, size }: { color: ColorValue; size: number }) {
  const { session } = useAuth();
  const hasUnread = useHasUnreadMessages(session?.user.id);

  return (
    <View>
      <MessageCircle color={color} size={size} />
      {hasUnread && <View style={styles.badge} />}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <TopTabs
      tabBarPosition="bottom"
      tabBar={(props: PillTabBarProps) => <PillTabBar {...props} />}
      screenOptions={{
        // No swipe between tabs: horizontal swipes belong to the screens (the
        // Workout week view steps weeks with them). Tabs change from the bar.
        swipeEnabled: false,
        // Build a tab when it is focused or next to it, but not all five (and
        // their queries) at launch.
        lazy: true,
        lazyPreloadDistance: 1,
        // No bottom padding here on purpose: the scene runs the full height so
        // content passes UNDER the bar and the blur has the page to sample.
        // Each screen's ScrollView leaves the room instead (useTabBarSpace).
        sceneStyle: { backgroundColor: colors.cream },
      }}
    >
      <TopTabs.Screen
        name="dashboard"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color, size }: TabIconProps) => <Home color={color} size={size} />,
        }}
      />
      <TopTabs.Screen
        name="workout"
        options={{
          title: "Workout",
          tabBarIcon: ({ color, size }: TabIconProps) => <Dumbbell color={color} size={size} />,
        }}
      />
      <TopTabs.Screen
        name="goals"
        options={{
          title: "Goals",
          tabBarIcon: ({ color, size }: TabIconProps) => <Target color={color} size={size} />,
        }}
      />
      <TopTabs.Screen
        name="progress"
        options={{
          title: "Progress",
          tabBarIcon: ({ color, size }: TabIconProps) => <TrendingUp color={color} size={size} />,
        }}
      />
      <TopTabs.Screen
        name="messages"
        options={{
          title: "Messages",
          tabBarIcon: ({ color, size }: TabIconProps) => <MessagesIcon color={color} size={size} />,
        }}
      />
    </TopTabs>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: -1,
    right: -3,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.bad,
  },
});
