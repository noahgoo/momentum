import {
  Bell,
  CalendarClock,
  Dumbbell,
  Flame,
  Home,
  Inbox,
  type LucideIcon,
  ListChecks,
  MessageCircle,
  Settings,
  Sparkles,
  Users,
  Waypoints,
} from "lucide-react";

export interface NavChild {
  to: string;
  label: string;
  Icon: LucideIcon;
}

export interface NavItem {
  to: string;
  label: string;
  Icon: LucideIcon;
  /** Exact-match highlighting (only the index route needs this). */
  end?: boolean;
  /** Rendered as a horizontal strip at the top of the section's pages. */
  children?: NavChild[];
  /** Which count, if any, this row shows as a badge. */
  badge?: "inbox";
}

/**
 * Five top-level sections. The grouping mirrors the tier model in AGENTS.md:
 * Library holds the template tier (authored once, reused by many clients),
 * Clients holds the instance tier, and Inbox holds the client-originated
 * event tier. Section children render as a sub-nav strip inside the section
 * rather than as an expanding sidebar tree, so the sidebar itself stays five
 * rows deep at all times.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Today", end: true, Icon: Home },
  { to: "/clients", label: "Clients", Icon: Users },
  {
    to: "/library/workouts",
    label: "Library",
    Icon: Dumbbell,
    children: [
      { to: "/library/workouts", label: "Workouts", Icon: Dumbbell },
      { to: "/library/warmups", label: "Warmups", Icon: Flame },
      { to: "/library/programs", label: "Programs", Icon: Waypoints },
      { to: "/library/exercises", label: "Exercises", Icon: ListChecks },
      { to: "/library/motivation", label: "Motivation", Icon: Sparkles },
    ],
  },
  {
    to: "/inbox/messages",
    label: "Inbox",
    Icon: Inbox,
    badge: "inbox",
    children: [
      { to: "/inbox/messages", label: "Messages", Icon: MessageCircle },
      { to: "/inbox/requests", label: "Requests", Icon: CalendarClock },
      { to: "/inbox/broadcast", label: "Broadcast", Icon: Bell },
    ],
  },
  { to: "/settings", label: "Settings", Icon: Settings },
];

/** The section a path belongs to, for sidebar highlighting and sub-nav lookup. */
export function sectionForPath(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => {
    if (item.end) return pathname === item.to;
    const prefix = item.children ? `/${item.to.split("/")[1]}` : item.to;
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
}

/**
 * Whether the section strip belongs on this path. A builder or detail route
 * is a leaf with its own back link and title, so it keeps the sidebar
 * highlight but drops the sub-nav — otherwise two sets of headings stack.
 */
export function showsSectionNav(pathname: string, section: NavItem | undefined): boolean {
  if (!section?.children) return false;
  return section.children.some((child) => child.to === pathname);
}
