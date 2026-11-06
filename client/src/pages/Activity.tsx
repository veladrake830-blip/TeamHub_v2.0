import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, NavLink, useSearchParams } from 'react-router-dom';
import {
  api,
  type ActivityDashboard,
  type ActivityEntry,
  type ActivityEntryInput,
  type ActivityPage,
  type OrganizationSettings,
  type Page,
  type TeamListItem,
} from '../api';
import { useMe } from '../auth';
import { Avatar, ErrorText, Field, PageHeader, useAction } from '../components/ui';
import { formatDay, formatMinutes, shiftDay } from '../dates';

const RANGES = [7, 30, 90];
const PAGE_SIZE = 50;

function ActivityTabs() {
  return (
    <nav className="tabs" aria-label="Activity views">
      <NavLink to="/activity" end>
        Dashboard
      </NavLink>
      <NavLink to="/activity/entries">Entries</NavLink>
    </nav>
  );
}

function useTeams() {
  return useQuery({
    queryKey: ['teams', 'directory', 'activity'],
    queryFn: () => api<Page<TeamListItem>>('/teams?pageSize=100'),
  });
}

function TeamFilter({ value, onChange }: { value: string; onChange(id: string): void }) {
  const teams = useTeams();
  return (
    <select className="input auto" aria-label="Filter by team" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All teams</option>
      {teams.data?.items.map((team) => (
        <option key={team.id} value={team.id}>
          {team.name}
        </option>
      ))}
    </select>
  );
}

/** The next clean hour step above the tallest day, so the axis reads 0, 2, 4 and not 0, 1.7, 3.4. */
function hourTicks(maxMinutes: number) {
  const maxHours = Math.max(maxMinutes / 60, 1);
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((candidate) => maxHours / candidate <= 4) ?? 1000;
  const top = Math.ceil(maxHours / step) * step;
  const ticks = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  return { ticks, top };
}

function DayChart({ days }: { days: ActivityDashboard['byDay'] }) {
  const { ticks, top } = hourTicks(Math.max(...days.map((day) => day.minutes)));
  const labelEvery = Math.ceil(days.length / 7);
  return (
    <div className="chart" role="img" aria-label="Hours recorded per day. The same values are in the table below.">
      <div className="chart-plot">
        {ticks.map((tick) => (
          <div key={tick} className="chart-grid" style={{ bottom: `${(tick / top) * 100}%` }}>
            <span>{tick}h</span>
          </div>
        ))}
        <div className="chart-bars">
          {days.map((day) => (
            <div key={day.date} className="chart-slot" tabIndex={0}>
              {day.minutes > 0 && <div className="chart-bar" style={{ height: `${(day.minutes / 60 / top) * 100}%` }} />}
              <div className="chart-tip">
                <strong>{formatMinutes(day.minutes)}</strong>
                <span>{formatDay(day.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="chart-labels">
        {days.map((day, index) => (
          <span key={day.date}>
            {(days.length - 1 - index) % labelEvery === 0 ? formatDay(day.date, { month: 'short', day: 'numeric' }) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function CategoryBars({ categories }: { categories: ActivityDashboard['byCategory'] }) {
  const max = categories[0]?.minutes ?? 1;
  return (
    <ul className="hbars">
      {categories.map((item) => (
        <li key={item.category} title={`${item.category}: ${formatMinutes(item.minutes)}`}>
          <span className="hbar-name truncate">{item.category}</span>
          <span className="hbar-track">
            <span className="hbar" style={{ width: `${(item.minutes / max) * 100}%` }} />
          </span>
          <span className="hbar-value">{formatMinutes(item.minutes)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ActivityDashboardPage() {
  const [rangeDays, setRangeDays] = useState(7);
  const [teamId, setTeamId] = useState('');
  const organization = useQuery({
    queryKey: ['organization'],
    queryFn: () => api<OrganizationSettings>('/settings/organization'),
  });
  const today = organization.data?.today;
  const dashboard = useQuery({
    queryKey: ['activity', 'dashboard', today, rangeDays, teamId],
    enabled: !!today,
    queryFn: () => {
      const params = new URLSearchParams({ from: shiftDay(today!, -(rangeDays - 1)), to: today! });
      if (teamId) params.set('teamId', teamId);
      return api<ActivityDashboard>(`/activity/dashboard?${params}`);
    },
  });
  const data = dashboard.data;

  return (
    <>
      <PageHeader title="Activity time" subtitle={data ? `Days follow the ${data.timezone} timezone.` : undefined} />
      <ActivityTabs />
      <div className="row filters">
        <div className="segmented" role="group" aria-label="Time range">
          {RANGES.map((days) => (
            <button key={days} className={days === rangeDays ? 'on' : ''} aria-pressed={days === rangeDays} onClick={() => setRangeDays(days)}>
              {days} days
            </button>
          ))}
        </div>
        <TeamFilter value={teamId} onChange={setTeamId} />
      </div>
      <ErrorText error={organization.error ?? dashboard.error} />

      {data && (
        <>
          <dl className="stats">
            <div>
              <dt>Time recorded</dt>
              <dd>{formatMinutes(data.totalMinutes)}</dd>
            </div>
            <div>
              <dt>People</dt>
              <dd>{data.peopleCount}</dd>
            </div>
            <div>
              <dt>Entries</dt>
              <dd>{data.entryCount}</dd>
            </div>
          </dl>

          {data.totalMinutes === 0 ? (
            <div className="empty spaced">No time recorded in this range.</div>
          ) : (
            <>
              <section className="card spaced">
                <h2>Hours per day</h2>
                <DayChart days={data.byDay} />
                <details className="table-view">
                  <summary>Show as table</summary>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Day</th>
                          <th scope="col">Time recorded</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.byDay.map((day) => (
                          <tr key={day.date}>
                            <td>{formatDay(day.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                            <td>{formatMinutes(day.minutes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </section>

              <section className="card">
                <h2>Time by category</h2>
                <CategoryBars categories={data.byCategory} />
              </section>

              <section>
                <h2>Time by person</h2>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Person</th>
                        <th scope="col" className="num">Time recorded</th>
                        <th scope="col" className="num">Active days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byPerson.map((person) => (
                        <tr key={person.id}>
                          <td>
                            <Link to={`/activity/entries?user=${person.id}`}>{person.name}</Link>
                          </td>
                          <td className="num">{formatMinutes(person.minutes)}</td>
                          <td className="num">{person.activeDays}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}

function EntryForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ActivityEntryInput;
  submitLabel: string;
  onSubmit(values: ActivityEntryInput): Promise<unknown>;
  onCancel?(): void;
}) {
  const [values, setValues] = useState(initial);
  const save = useAction(() => onSubmit(values), [['activity']]);
  const set = (key: keyof ActivityEntryInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues({ ...values, [key]: e.target.value });
  const suggestions = useQuery({
    queryKey: ['activity', 'categories'],
    queryFn: () => api<ActivityDashboard>('/activity/dashboard'),
  });
  return (
    <form
      className="entry-form"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="entry-fields">
        <Field label="Start">
          <input className="input" type="time" required value={values.start} onChange={set('start')} />
        </Field>
        <Field label="End">
          <input className="input" type="time" required value={values.end} onChange={set('end')} />
        </Field>
        <Field label="Category">
          <input className="input" required maxLength={60} list="activity-categories" value={values.category} onChange={set('category')} />
        </Field>
        <Field label="Note">
          <input className="input" maxLength={500} value={values.note} onChange={set('note')} />
        </Field>
      </div>
      <datalist id="activity-categories">
        {suggestions.data?.byCategory.map((item) => <option key={item.category} value={item.category} />)}
      </datalist>
      <ErrorText error={save.error} />
      <div className="row">
        <button className="btn primary" disabled={save.isPending}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function EntryRow({ entry, showDate }: { entry: ActivityEntry; showDate: boolean }) {
  const [editing, setEditing] = useState(false);
  const remove = useAction(() => api(`/activity/entries/${entry.id}`, { method: 'DELETE' }), [['activity']]);

  if (editing) {
    return (
      <li className="list-row">
        <div className="grow">
          <EntryForm
            initial={{ start: entry.start, end: entry.end, category: entry.category, note: entry.note }}
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={(values) =>
              api(`/activity/entries/${entry.id}`, { method: 'PUT', body: values }).then(() => setEditing(false))
            }
          />
        </div>
      </li>
    );
  }
  return (
    <li className="list-row">
      <Avatar name={entry.user.name} url={entry.user.avatarUrl} size={32} />
      <div className="grow">
        <div>
          <Link to={`/activity/entries?user=${entry.user.id}`}>{entry.user.name}</Link>
          {entry.user.deactivated && <span className="tag warn"> Deactivated</span>}
        </div>
        <div className="small">
          {showDate && `${formatDay(entry.date, { month: 'short', day: 'numeric' })}, `}
          {entry.start} to {entry.end} ({formatMinutes(entry.minutes)}) · {entry.category}
        </div>
        {entry.note && <div className="muted small result">{entry.note}</div>}
        <ErrorText error={remove.error} />
      </div>
      {entry.canEdit && (
        <>
          <button className="btn ghost small" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            className="btn ghost small"
            onClick={() => {
              if (window.confirm('Delete this entry?')) remove.mutate();
            }}
          >
            Delete
          </button>
        </>
      )}
    </li>
  );
}

function useEntries(filter: { date?: string; userId?: string; teamId?: string }) {
  return useInfiniteQuery({
    queryKey: ['activity', 'entries', filter],
    initialPageParam: 1,
    getNextPageParam: (last: ActivityPage, pages) => (pages.length * PAGE_SIZE < last.total ? pages.length + 1 : undefined),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ page: String(pageParam), pageSize: String(PAGE_SIZE) });
      for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value);
      return api<ActivityPage>(`/activity/entries?${params}`);
    },
  });
}

function EntryList({ query, showDate }: { query: ReturnType<typeof useEntries>; showDate: boolean }) {
  const entries = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <ErrorText error={query.error} />
      {query.isSuccess && entries.length === 0 && <div className="empty">No entries to show.</div>}
      {entries.length > 0 && (
        <ul className="list">
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} showDate={showDate} />
          ))}
        </ul>
      )}
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

function DayEntries() {
  const me = useMe();
  const [search, setSearch] = useSearchParams();
  const [teamId, setTeamId] = useState('');
  const [formKey, setFormKey] = useState(0);
  const requested = search.get('date') ?? undefined;
  const entries = useEntries({ date: requested, teamId: teamId || undefined });
  const first = entries.data?.pages[0];
  const today = first?.today;
  const date = requested ?? today;
  const canAdd = !!first?.canRecord && !!today && !!date && (date === today || date === shiftDay(today, -1));
  const goTo = (day: string) => setSearch(day === today ? {} : { date: day }, { replace: true });

  return (
    <>
      <PageHeader title="Activity time" subtitle={first ? `Days follow the ${first.timezone} timezone.` : undefined} />
      <ActivityTabs />
      {date && today && (
        <div className="row day-nav">
          <button className="btn small" aria-label="Previous day" onClick={() => goTo(shiftDay(date, -1))}>
            Previous
          </button>
          <input className="input auto" type="date" aria-label="Day" max={today} value={date} onChange={(e) => e.target.value && goTo(e.target.value)} />
          <button className="btn small" aria-label="Next day" disabled={date >= today} onClick={() => goTo(shiftDay(date, 1))}>
            Next
          </button>
          {date !== today && (
            <button className="btn ghost small" onClick={() => goTo(today)}>
              Today
            </button>
          )}
          <TeamFilter value={teamId} onChange={setTeamId} />
        </div>
      )}
      <h2 className="day-title">{date && formatDay(date)}</h2>

      {canAdd && (
        <section className="card">
          <h2>Add your time</h2>
          <EntryForm
            key={`${date}-${formKey}`}
            initial={{ start: '', end: '', category: '', note: '' }}
            submitLabel="Add entry"
            onSubmit={(values) =>
              api('/activity/entries', { method: 'POST', body: { date, ...values } }).then(() => setFormKey(formKey + 1))
            }
          />
        </section>
      )}
      {first && !first.canRecord && !me.isAdmin && (
        <p className="muted">
          Join a team to record your own time. <Link to="/teams">Browse teams</Link>
        </p>
      )}
      <EntryList query={entries} showDate={false} />
    </>
  );
}

function PersonEntries({ userId }: { userId: string }) {
  const entries = useEntries({ userId });
  const name = entries.data?.pages[0]?.items[0]?.user.name;
  return (
    <>
      <PageHeader title={name ? `${name}'s activity time` : 'Activity time'} />
      <p>
        <Link to="/activity/entries">Back to all entries</Link>
      </p>
      <EntryList query={entries} showDate />
    </>
  );
}

export function ActivityEntriesPage() {
  const [search] = useSearchParams();
  const userId = search.get('user');
  return userId ? <PersonEntries key={userId} userId={userId} /> : <DayEntries />;
}
