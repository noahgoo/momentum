import { useChangeRequests } from "./useChangeRequests";
import { useThreadsQuery } from "./useThreads";

/**
 * The single number on the sidebar's Inbox row: unread threads plus pending
 * change requests — the two things in the inbox that are waiting on the
 * coach.
 *
 * Reads both lists through their normal query keys, so while the inbox is
 * open this shares the rows that page already has (and rides its realtime
 * subscription for free). It deliberately uses `useThreadsQuery` rather than
 * `useThreads`: the sidebar is mounted on every route, and a second realtime
 * subscription on the same table would both duplicate the channel and — since
 * a channel name maps to one channel object — collide with the inbox's own.
 */
export function useInboxCount(): number {
  const { data: threads } = useThreadsQuery();
  const { data: requests } = useChangeRequests();

  const unreadThreads = (threads ?? []).filter((t) => t.unread_for_coach).length;
  const pendingRequests = requests?.pending.length ?? 0;

  return unreadThreads + pendingRequests;
}
