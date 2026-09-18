import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "expo-router/tabs";
import { colors, fonts, shadows, spacing } from "../theme/tokens";

const BAR_HEIGHT = 68;
/** Gap between the pill and the safe-area edge, so content shows underneath. */
const BAR_GAP = 10;
const BAR_INSET = 14;
const ICON_CIRCLE = 34;

/**
 * Bottom padding a scrolling screen needs so its LAST row can be scrolled out
 * from under the bar.
 *
 * This is padding on the scroll content, not on the scene: the page has to run
 * the full height of the screen for the bar to have anything to blur. Padding
 * the scene instead would leave the bar frosting a flat expanse of cream.
 */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return Math.max(insets.bottom, BAR_GAP) + BAR_HEIGHT + BAR_GAP;
}

/**
 * The bottom navigation: a frosted pill floating over the page.
 *
 * Every tab keeps its label under its icon, so you can read where a tab goes
 * without being on it. The focused tab is marked by a filled circle behind its
 * ICON only, leaving the label free — the same circle-fill this app already
 * uses to mean "selected" on a goal checkbox.
 *
 * The pill is translucent over a BlurView, so what sits behind it is the
 * client's own page out of focus rather than a flat panel.
 */
export function PillTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={[styles.dock, { paddingBottom: Math.max(insets.bottom, BAR_GAP) }]}
    >
      {/* Two wrappers, deliberately. `overflow: hidden` is what clips the blur
          to the pill, and on iOS it clips the shadow off that same view too —
          so the shadow lives out here and the clipping lives inside. With both
          on one view the bar rendered flat, with no lift off the page.
          This wrapper must stay transparent: an opaque background here is what
          BlurView would sample, and the blur would show a flat panel. */}
      <View style={[styles.barShadow, shadows.card]}>
        <BlurView
          intensity={Platform.OS === "android" ? 70 : 55}
          tint="light"
          // Android falls back to a flat overlay without this — no real blur.
          experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}
          style={styles.bar}
        >
          {/* Wash over the blur: keeps icon contrast steady as content scrolls
              past, and pitches the bar a step darker than the page and the
              cards so it reads as a separate surface. */}
          <View pointerEvents="none" style={styles.barWash} />

          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key]!;
            const focused = state.index === index;
            const label = options.title ?? route.name;

            function onPress() {
              // Emitting rather than navigating directly is what lets a screen
              // intercept a tab press (scroll-to-top, unsaved-changes guard).
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            }

            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                onLongPress={() =>
                  navigation.emit({ type: "tabLongPress", target: route.key })
                }
                accessibilityRole="button"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
                style={styles.item}
              >
                <View style={[styles.iconSlot, focused && styles.iconSlotFocused]}>
                  {options.tabBarIcon?.({
                    focused,
                    color: focused ? colors.cream : colors.ink50,
                    size: 20,
                  })}
                </View>
                <Text
                  style={[styles.label, focused && styles.labelFocused]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </BlurView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: BAR_INSET,
  },
  barShadow: {
    borderRadius: BAR_HEIGHT / 2,
    // Deliberately no `overflow` and no background — see the call site.
  },
  bar: {
    height: BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xs,
    borderRadius: BAR_HEIGHT / 2,
    // Clips the blur to the pill; without it the backdrop renders square.
    overflow: "hidden",
    // Frosted glass needs a defined edge or it dissolves into a pale page
    // exactly where it is supposed to stand out.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.ink15,
  },
  barWash: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.navWash,
  },
  item: {
    // flex rather than a fixed width so the five items divide the bar exactly
    // at any screen size, with the label centred under its own icon.
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  iconSlot: {
    width: ICON_CIRCLE,
    height: ICON_CIRCLE,
    borderRadius: ICON_CIRCLE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  iconSlotFocused: {
    backgroundColor: colors.ink,
  },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    color: colors.ink70,
  },
  labelFocused: {
    fontFamily: fonts.bodySemiBold,
    color: colors.ink,
  },
});
