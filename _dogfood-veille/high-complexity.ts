// High-complexity request router — intentional violation for dogfood testing.
// Expected: cyclomatic error (>30), cognitive error (>30), halstead_effort warning

interface Request {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}
interface Response {
  status: number;
  body: unknown;
}

export function handleRequest(req: Request): Response {
  if (req.method === 'GET') {
    if (req.path === '/users') {
      if (req.query?.role === 'admin') {
        if (req.query?.active === 'true') {
          return { status: 200, body: { users: [], filter: 'active-admins' } };
        } else if (req.query?.active === 'false') {
          return { status: 200, body: { users: [], filter: 'inactive-admins' } };
        } else {
          return { status: 200, body: { users: [], filter: 'all-admins' } };
        }
      } else if (req.query?.role === 'editor') {
        if (req.query?.department) {
          return { status: 200, body: { users: [], filter: 'dept-editors' } };
        }
        return { status: 200, body: { users: [], filter: 'editors' } };
      } else if (req.query?.search) {
        if (req.query.search.length < 3) {
          return { status: 400, body: { error: 'Search query too short' } };
        }
        return { status: 200, body: { users: [], search: req.query.search } };
      } else {
        return { status: 200, body: { users: [] } };
      }
    } else if (req.path === '/posts') {
      if (req.query?.category) {
        if (req.query?.sort === 'date') {
          return { status: 200, body: { posts: [], sort: 'date' } };
        } else if (req.query?.sort === 'popular') {
          return { status: 200, body: { posts: [], sort: 'popular' } };
        }
        return { status: 200, body: { posts: [], category: req.query.category } };
      } else if (req.query?.author) {
        return { status: 200, body: { posts: [], author: req.query.author } };
      }
      return { status: 200, body: { posts: [] } };
    } else if (req.path === '/comments') {
      if (req.query?.postId) {
        if (req.query?.threaded === 'true') {
          return { status: 200, body: { comments: [], threaded: true } };
        }
        return { status: 200, body: { comments: [] } };
      }
      return { status: 400, body: { error: 'postId required' } };
    } else if (req.path === '/tags') {
      return { status: 200, body: { tags: [] } };
    } else if (req.path === '/health') {
      return { status: 200, body: { ok: true } };
    } else {
      return { status: 404, body: { error: 'Not found' } };
    }
  } else if (req.method === 'POST') {
    if (req.path === '/users') {
      if (!req.body?.email) {
        return { status: 400, body: { error: 'Email required' } };
      }
      if (!req.body?.name) {
        return { status: 400, body: { error: 'Name required' } };
      }
      if (req.body?.role === 'admin') {
        if (!req.headers?.['x-admin-key']) {
          return { status: 403, body: { error: 'Admin key required' } };
        }
      }
      return { status: 201, body: { created: true } };
    } else if (req.path === '/posts') {
      if (!req.body?.title || !req.body?.content) {
        return { status: 400, body: { error: 'Title and content required' } };
      }
      if (typeof req.body.title !== 'string' || req.body.title.length > 200) {
        return { status: 400, body: { error: 'Invalid title' } };
      }
      return { status: 201, body: { created: true } };
    } else if (req.path === '/comments') {
      if (!req.body?.text || !req.body?.postId) {
        return { status: 400, body: { error: 'Text and postId required' } };
      }
      return { status: 201, body: { created: true } };
    } else {
      return { status: 404, body: { error: 'Not found' } };
    }
  } else if (req.method === 'PUT') {
    if (req.path.startsWith('/users/')) {
      if (!req.body) {
        return { status: 400, body: { error: 'Body required' } };
      }
      return { status: 200, body: { updated: true } };
    } else if (req.path.startsWith('/posts/')) {
      if (!req.body?.title && !req.body?.content) {
        return { status: 400, body: { error: 'Nothing to update' } };
      }
      return { status: 200, body: { updated: true } };
    }
    return { status: 404, body: { error: 'Not found' } };
  } else if (req.method === 'DELETE') {
    if (req.path.startsWith('/users/')) {
      if (!req.headers?.['x-admin-key']) {
        return { status: 403, body: { error: 'Admin key required' } };
      }
      return { status: 204, body: null };
    } else if (req.path.startsWith('/posts/')) {
      return { status: 204, body: null };
    }
    return { status: 404, body: { error: 'Not found' } };
  } else if (req.method === 'PATCH') {
    if (req.path.startsWith('/users/')) {
      return { status: 200, body: { patched: true } };
    }
    return { status: 404, body: { error: 'Not found' } };
  } else {
    return { status: 405, body: { error: 'Method not allowed' } };
  }
}
