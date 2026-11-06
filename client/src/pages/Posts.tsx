import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type PostAnswer, type PostAuthor, type PostDetail, type PostKind, type PostListPage } from '../api';
import { Avatar, ErrorText, Field, PageHeader, useAction } from '../components/ui';

const PAGE_SIZE = 20;

const COPY = {
  NEWS: { title: 'News', subtitle: 'Announcements for the whole organization.', noun: 'announcement', add: 'New announcement', empty: 'No news yet.', back: '/news' },
  TOPIC: { title: 'Forum', subtitle: 'Discussion topics for the whole organization.', noun: 'topic', add: 'New topic', empty: 'No topics yet.', back: '/forum' },
};

const when = (date: string) => new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function Byline({ author, createdAt, editedAt }: { author: PostAuthor; createdAt: string; editedAt: string | null }) {
  return (
    <div className="byline">
      <Avatar name={author.name} url={author.avatarUrl} size={24} />
      <Link to={`/people/${author.id}`}>{author.name}</Link>
      {author.deactivated && <span className="tag warn">Deactivated</span>}
      <span className="muted small">
        {when(createdAt)}
        {editedAt && ' · edited'}
      </span>
    </div>
  );
}

function Composer({ kind, onDone }: { kind: PostKind; onDone(): void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const copy = COPY[kind];
  const create = useAction(async () => {
    const post = await api<{ id: string }>('/posts', { method: 'POST', body: { kind, title, body } });
    navigate(`/posts/${post.id}`);
  }, [['posts']]);
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <h2>{copy.add}</h2>
      <Field label="Title">
        <input className="input" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Text">
        <textarea className="input" required rows={6} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <ErrorText error={create.error} />
      <div className="row">
        <button className="btn primary" disabled={create.isPending}>
          Publish
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function PostList({ kind }: { kind: PostKind }) {
  const copy = COPY[kind];
  const [q, setQ] = useState('');
  const [composing, setComposing] = useState(false);
  const posts = useInfiniteQuery({
    queryKey: ['posts', kind, q],
    initialPageParam: 1,
    getNextPageParam: (last: PostListPage, pages) => (pages.length * PAGE_SIZE < last.total ? pages.length + 1 : undefined),
    queryFn: ({ pageParam }) =>
      api<PostListPage>(`/posts?kind=${kind}&pageSize=${PAGE_SIZE}&page=${pageParam}&q=${encodeURIComponent(q)}`),
  });
  const items = posts.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        title={copy.title}
        subtitle={copy.subtitle}
        actions={
          !composing ? (
            <button className="btn primary" onClick={() => setComposing(true)}>
              {copy.add}
            </button>
          ) : undefined
        }
      />
      {composing && <Composer kind={kind} onDone={() => setComposing(false)} />}
      <input className="input search" placeholder="Search titles" aria-label={`Search ${copy.title}`} value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorText error={posts.error} />
      {posts.isSuccess && items.length === 0 && <div className="empty">{q ? 'No matches.' : copy.empty}</div>}
      {items.map((post) => (
        <article key={post.id} className="card post-row">
          <h2>
            <Link to={`/posts/${post.id}`}>{post.title}</Link>
          </h2>
          <p className="muted excerpt">{post.excerpt}</p>
          <div className="row">
            <Byline author={post.author} createdAt={post.createdAt} editedAt={post.editedAt} />
            {kind === 'TOPIC' && (
              <span className="muted small">
                {post.answerCount} {post.answerCount === 1 ? 'answer' : 'answers'}
              </span>
            )}
          </div>
        </article>
      ))}
      {posts.hasNextPage && (
        <div className="row pager">
          <button className="btn" disabled={posts.isFetchingNextPage} onClick={() => void posts.fetchNextPage()}>
            Load more
          </button>
        </div>
      )}
    </>
  );
}

function PostEditor({ post, onDone }: { post: PostDetail; onDone(): void }) {
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const save = useAction(
    () => api(`/posts/${post.id}`, { method: 'PATCH', body: { title, body } }).then(onDone),
    [['posts']],
  );
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Title">
        <input className="input" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Text">
        <textarea className="input" required rows={8} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <ErrorText error={save.error} />
      <div className="row">
        <button className="btn primary" disabled={save.isPending}>
          Save
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AnswerItem({ answer }: { answer: PostAnswer }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(answer.body);
  const save = useAction(
    () => api(`/answers/${answer.id}`, { method: 'PATCH', body: { body } }).then(() => setEditing(false)),
    [['posts']],
  );
  const remove = useAction(() => api(`/answers/${answer.id}`, { method: 'DELETE' }), [['posts']]);

  return (
    <li className="answer">
      <div className="row">
        <div className="grow">
          <Byline author={answer.author} createdAt={answer.createdAt} editedAt={answer.editedAt} />
        </div>
        {answer.canEdit && !editing && (
          <>
            <button
              className="btn ghost small"
              onClick={() => {
                setBody(answer.body);
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button
              className="btn ghost small"
              onClick={() => {
                if (window.confirm('Delete this answer?')) remove.mutate();
              }}
            >
              Delete
            </button>
          </>
        )}
      </div>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <textarea className="input" required rows={4} maxLength={20000} aria-label="Edit answer" value={body} onChange={(e) => setBody(e.target.value)} />
          <ErrorText error={save.error} />
          <div className="row answer-actions">
            <button className="btn primary small" disabled={save.isPending}>
              Save
            </button>
            <button type="button" className="btn small" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className="text">{answer.body}</p>
      )}
      <ErrorText error={remove.error} />
    </li>
  );
}

function AnswerForm({ postId }: { postId: string }) {
  const [body, setBody] = useState('');
  const send = useAction(
    () => api(`/posts/${postId}/answers`, { method: 'POST', body: { body } }).then(() => setBody('')),
    [['posts']],
  );
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      <Field label="Your answer">
        <textarea className="input" required rows={4} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <ErrorText error={send.error} />
      <button className="btn primary" disabled={send.isPending}>
        Post answer
      </button>
    </form>
  );
}

export function PostPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const post = useQuery({ queryKey: ['posts', 'detail', id], queryFn: () => api<PostDetail>(`/posts/${id}`) });
  const copy = COPY[post.data?.kind ?? 'TOPIC'];
  const remove = useAction(async () => {
    await api(`/posts/${id}`, { method: 'DELETE' });
    navigate(copy.back);
  }, [['posts', 'NEWS'], ['posts', 'TOPIC']]);

  if (post.isPending) return <p className="muted">Loading…</p>;
  if (post.isError) {
    return (
      <>
        <ErrorText error={post.error} />
        <Link to="/forum">Back to the forum</Link>
      </>
    );
  }
  const data = post.data;

  return (
    <>
      <p>
        <Link to={copy.back}>Back to {copy.title}</Link>
      </p>
      {editing ? (
        <PostEditor post={data} onDone={() => setEditing(false)} />
      ) : (
        <article>
          <div className="page-header">
            <h1>{data.title}</h1>
            {data.canEdit && (
              <div className="row">
                <button className="btn small" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button
                  className="btn ghost small"
                  onClick={() => {
                    if (window.confirm(`Delete this ${copy.noun}?`)) remove.mutate();
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
          <Byline author={data.author} createdAt={data.createdAt} editedAt={data.editedAt} />
          <p className="text post-body">{data.body}</p>
        </article>
      )}
      <ErrorText error={remove.error} />

      {data.kind === 'TOPIC' && (
        <section>
          <h2>
            {data.answers.length} {data.answers.length === 1 ? 'answer' : 'answers'}
          </h2>
          {data.answers.length > 0 && (
            <ul className="answers">
              {data.answers.map((answer) => (
                <AnswerItem key={answer.id} answer={answer} />
              ))}
            </ul>
          )}
          <AnswerForm postId={data.id} />
        </section>
      )}
    </>
  );
}
