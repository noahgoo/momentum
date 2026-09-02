import { View, StyleSheet, type ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { Home, Dumbbell, Target, TrendingUp, MessageCircle, Users } from "lucide-react-native";
import { colors, fonts } from "../../theme/tokens";
import { useAuth } from "../../lib/auth";
import { useHasUnreadMessages } from "../../lib/queries/useUnreadMessages";

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
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.blueDeep,
        tabBarInactiveTintColor: colors.ink30,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.bodyMedium,
          fontSize: 11,
        },
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
      <Tabs.Screen
        name="friends"
        options={{
          title: "Friends",
          tabBarIcon: ({ color, size }) => <Users color={color} size={size} />,
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
