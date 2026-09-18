import { View, StyleSheet, type ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { Home, Dumbbell, Target, TrendingUp, MessageCircle } from "lucide-react-native";
import { colors } from "../../theme/tokens";
import { useAuth } from "../../lib/auth";
import { useHasUnreadMessages } from "../../lib/queries/useUnreadMessages";
import { PillTabBar } from "../../components/PillTabBar";

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
    <Tabs
      tabBar={(props) => <PillTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        // No bottom padding here on purpose: the scene runs the full height so
        // content passes UNDER the bar and the blur has the page to sample.
        // Each screen's ScrollView leaves the room instead (useTabBarSpace).
        sceneStyle: { backgroundColor: colors.cream },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="workout"
        options={{
          title: "Workout",
          tabBarIcon: ({ color, size }) => <Dumbbell color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          title: "Goals",
          tabBarIcon: ({ color, size }) => <Target color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: "Progress",
          tabBarIcon: ({ color, size }) => <TrendingUp color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          tabBarIcon: ({ color, size }) => <MessagesIcon color={color} size={size} />,
        }}
      />
    </Tabs>
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
