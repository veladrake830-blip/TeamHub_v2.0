import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type Page, type Profile, type TeamListItem, type WorkLogPage, type WorkPlan, type WorkTaskInput } from '../api';
import { useMe } from '../auth';
import { Avatar, ErrorText, PageHeader, useAction } from '../components/ui';
import { formatDay, shiftDay } from '../dates';

const MIN_TASKS = 2;
const MAX_TASKS = 5;
const PAGE_SIZE = 30;

function PlanForm({
  title,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: WorkTaskInput[];
  submitLabel: string;
  onSubmit(tasks: WorkTaskInput[]): Promise<unknown>;
  onCancel?(): void;
}) {
  const [tasks, setTasks] = useState(initial);
  const save = useAction(() => onSubmit(tasks), [['work-logs']]);
  const change = (index: number, field: keyof WorkTaskInput, value: string) =>
    setTasks(tasks.map((task, i) => (i === index ? { ...task, [field]: value } : task)));

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2>{title}</h2>
      <ol className="task-fields">
        {tasks.map((task, index) => (
          <li key={index}>
            <input
              className="input"
              required
              maxLength={500}
              placeholder={`Task ${index + 1}`}
              aria-label={`Task ${index + 1}`}
              value={task.title}
              onChange={(e) => change(index, 'title', e.target.value)}
            />
            <textarea
              className="input"
              rows={2}
              maxLength={2000}
              placeholder="Result"
              aria-label={`Result of task ${index + 1}`}
              value={task.result}
              onChange={(e) => change(index, 'result', e.target.value)}
            />
            {tasks.length > MIN_TASKS && (
              <button
                type="button"
                className="btn ghost small"
                aria-label={`Remove task ${index + 1}`}
                onClick={() => setTasks(tasks.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ol>
      <ErrorText error={save.error} />
      <div className="row">
        <button className="btn primary" disabled={save.isPending}>
          {submitLabel}
        </button>
        {tasks.length < MAX_TASKS && (
          <button type="button" className="btn" onClick={() => setTasks([...tasks, { title: '', result: '' }])}>
            Add task
          </button>
        )}
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function PlanCard({ plan, showDate }: { plan: WorkPlan; showDate: boolean }) {
  const [editing, setEditing] = useState(false);
  const toInput = plan.tasks.map(({ title, result }) => ({ title, result }));

  if (editing) {
    return (
      <PlanForm
        title={`Edit plan for ${formatDay(plan.date)}`}
        initial={toInput}
        submitLabel="Save plan"
        onCancel={() => setEditing(false)}
        onSubmit={(tasks) =>
          api(`/work-logs/${plan.id}`, { method: 'PUT', body: { tasks } }).then(() => setEditing(false))
        }
      />
    );
  }
  return (
    <article className="card plan">
      <header className="row">
        <Avatar name={plan.user.name} url={plan.user.avatarUrl} size={32} />
        <div className="grow">
          <Link to={`/people/${plan.user.id}`}>{plan.user.name}</Link>
          {showDate && <div className="muted small">{formatDay(plan.date)}</div>}
        </div>
        {plan.user.deactivated && <span className="tag warn">Deactivated</span>}
        {plan.canEdit && (
          <button className="btn small" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </header>
      <ol className="tasks">
        {plan.tasks.map((task) => (
          <li key={task.id}>
            <div>{task.title}</div>
            {task.result ? <div className="muted result">{task.result}</div> : <div className="muted small">No result yet</div>}
          </li>
        ))}
      </ol>
    </article>
  );
}

function usePlans(filter: { date?: string; userId?: string; teamId?: string }) {
  return useInfiniteQuery({
    queryKey: ['work-logs', filter],
    initialPageParam: 1,
    getNextPageParam: (last: WorkLogPage, pages) =>
      pages.length * PAGE_SIZE < last.total ? pages.length + 1 : undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ page: String(pageParam), pageSize: String(PAGE_SIZE) });
      for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value);
      return api<WorkLogPage>(`/work-logs?${params}`);
    },
  });
}

function PlanList({ query, showDate }: { query: ReturnType<typeof usePlans>; showDate: boolean }) {
  const plans = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <ErrorText error={query.error} />
      {query.isSuccess && plans.length === 0 && <div className="empty">No plans to show.</div>}
      {plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} showDate={showDate} />
      ))}
      {query.hasNextPage && (
        <div className="row pager">
          <button className="btn" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            Load more
          </button>
        </div>
      )}
    </>
  );
}

function PersonHistory({ userId }: { userId: string }) {
  const person = useQuery({ queryKey: ['users', userId], queryFn: () => api<Profile>(`/users/${userId}`) });
  const plans = usePlans({ userId });
  return (
    <>
      <PageHeader title={person.data ? `${person.data.name}'s work log` : 'Work log'} />
      <p>
        <Link to="/work-log">Back to all plans</Link>
      </p>
      <PlanList query={plans} showDate />
    </>
  );
}

function DayView() {
  const me = useMe();
  const [search, setSearch] = useSearchParams();
  const [teamId, setTeamId] = useState('');
  const requested = search.get('date') ?? undefined;

  const context = usePlans({ date: requested, teamId: teamId || undefined });
  const first = context.data?.pages[0];
  const today = first?.today;
  const date = requested ?? today;

  // My plan is looked up separately, so a team filter can't hide it and offer a second one.
  const mine = usePlans({ date, userId: me.id });
  const hasPlan = (mine.data?.pages[0]?.items.length ?? 0) > 0;
  const teams = useQuery({
    queryKey: ['teams', 'directory', 'work-log'],
    queryFn: () => api<Page<TeamListItem>>('/teams?pageSize=100'),
  });

  const canCreate =
    !!first?.canRecord && !!today && !!date && mine.isSuccess && !hasPlan && (date === today || date === shiftDay(today, -1));
  const goTo = (day: string) => setSearch(day === today ? {} : { date: day }, { replace: true });

  return (
    <>
      <PageHeader title="Work log" subtitle={first ? `Days follow the ${first.timezone} timezone.` : undefined} />

      {date && today && (
        <div className="row day-nav">
          <button className="btn small" aria-label="Previous day" onClick={() => goTo(shiftDay(date, -1))}>
            Previous
          </button>
          <input
            className="input auto"
            type="date"
            aria-label="Day"
            max={today}
            value={date}
            onChange={(e) => e.target.value && goTo(e.target.value)}
          />
          <button className="btn small" aria-label="Next day" disabled={date >= today} onClick={() => goTo(shiftDay(date, 1))}>
            Next
          </button>
          {date !== today && (
            <button className="btn ghost small" onClick={() => goTo(today)}>
              Today
            </button>
          )}
          <select className="input auto" aria-label="Filter by team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">All teams</option>
            {teams.data?.items.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <h2 className="day-title">{date && formatDay(date)}</h2>

      {canCreate && (
        <PlanForm
          key={date}
          title="Your plan"
          initial={[
            { title: '', result: '' },
            { title: '', result: '' },
          ]}
          submitLabel="Save plan"
          onSubmit={(tasks) => api('/work-logs', { method: 'POST', body: { date, tasks } })}
        />
      )}
      {first && !first.canRecord && !me.isAdmin && (
        <p className="muted">
          Join a team to record your own plan. <Link to="/teams">Browse teams</Link>
        </p>
      )}

      <PlanList query={context} showDate={false} />
    </>
  );
}

export function WorkLog() {
  const [search] = useSearchParams();
  const userId = search.get('user');
  return userId ? <PersonHistory key={userId} userId={userId} /> : <DayView />;
}
