import { Link, useParams } from "react-router";
import { ClientHeaderCard } from "../components/clients/ClientHeaderCard";
import { GoalsPanel } from "../components/clients/GoalsPanel";
import { MeasurementsPanel } from "../components/clients/MeasurementsPanel";
import { ProgressPhotosStrip } from "../components/clients/ProgressPhotosStrip";
import { RecentWorkouts } from "../components/clients/RecentWorkouts";
import { WorkoutHeatmap } from "../components/clients/WorkoutHeatmap";
import { useClientDate } from "../lib/useClientDate";
import { useAuth } from "../lib/auth";
import { useClientDetail, useToggleClientDisabled } from "../queries/useClientDetail";
import { useClientProgressPhotos } from "../queries/useClientProgressPhotos";

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="admin-card p-6">
      <h2 className="mb-4 text-sm font-semibold text-[var(--ink)]">{title}</h2>
      {children}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="max-w-3xl space-y-6">
      <div className="h-5 w-32 animate-pulse rounded bg-[var(--ink-08)]" />
      <div className="admin-card animate-pulse p-6">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-[var(--ink-08)]" />
          <div className="space-y-2">
            <div className="h-5 w-40 rounded bg-[var(--ink-08)]" />
            <div className="h-3 w-52 rounded bg-[var(--ink-08)]" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile: coachProfile } = useAuth();
  const { today: clientTodayStr } = useClientDate(id);
  const { data, isLoading, isError } = useClientDetail(id, clientTodayStr);
  const { data: photos } = useClientProgressPhotos(id);
  const toggleDisabled = useToggleClientDisabled(id ?? "");

  if (isLoading || !data) {
    return <DetailSkeleton />;
  }

  if (isError) {
    return (
      <div className="text-sm text-[var(--bad)]">
        Failed to load this client.{" "}
        <Link to="/clients" className="underline">
          Back to clients
        </Link>
      </div>
    );
  }

  const { profile, streak, programStatus, logs, workoutsById, measurements } = data;

  return (
    <div className="max-w-3xl space-y-6">
      <Link to="/clients" className="text-sm text-[var(--ink-50)] transition hover:text-[var(--ink)]">
        ← Clients
      </Link>

      <ClientHeaderCard
        profile={profile}
        streak={streak}
        programStatus={programStatus}
        onToggleDisabled={() => toggleDisabled.mutate(!profile.disabled)}
        togglePending={toggleDisabled.isPending}
      />

      <SectionCard title="Workout history">
        <WorkoutHeatmap logs={logs} todayStr={clientTodayStr} />
      </SectionCard>

      <SectionCard title="Recent workouts">
        <RecentWorkouts
          logs={logs}
          workoutsById={workoutsById}
        />
      </SectionCard>

      <div className="admin-card p-6">
        {coachProfile && <GoalsPanel clientId={profile.id} coachId={coachProfile.id} />}
      </div>

      <SectionCard title="Measurements">
        <MeasurementsPanel measurements={measurements} sex={profile.sex} heightIn={profile.height_in} />
      </SectionCard>

      <SectionCard title="Progress photos">
        <ProgressPhotosStrip photos={photos ?? []} />
      </SectionCard>
    </div>
  );
}
