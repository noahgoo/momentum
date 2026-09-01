export interface NavItem {
  to: string;
  label: string;
  /** Exact-match highlighting (only the index route needs this). */
  end?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/clients", label: "Clients" },
  { to: "/workouts", label: "Workouts" },
  { to: "/warmups", label: "Warmups" },
  { to: "/programs", label: "Programs" },
  { to: "/assign", label: "Assign" },
  { to: "/motivation", label: "Motivation" },
  { to: "/messages", label: "Messages" },
  { to: "/change-requests", label: "Change Requests" },
  { to: "/notifications", label: "Notifications" },
  { to: "/exercises", label: "Exercises" },
  { to: "/settings", label: "Settings" },
];
