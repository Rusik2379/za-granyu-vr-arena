export class BookNowError extends Error {
  constructor(status, data) {
    super('BookNow request failed');
    this.status = status;
    this.data = data;
  }
}

export function createBookNowClient({token, workspace, transport = fetch}) {
  if (!token || !workspace) throw new Error('Set BOOKNOW_API_KEY and BOOKNOW_WORKSPACE');
  async function request(path, body) {
    const response = await transport('https://my.booknow.ru/api/public/v2' + path, {
      method: body ? 'POST' : 'GET',
      headers: {Authorization: 'Bearer ' + token, Workspace: workspace, Accept: 'application/json',
        ...(body ? {'Content-Type': 'application/json'} : {})},
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error', signal: AbortSignal.timeout(20000)
    });
    const data = await response.json();
    if (!response.ok) throw new BookNowError(response.status, data);
    return data;
  }
  async function list(path) {
    const rows = [];
    for (let page = 1; page <= 100; page++) {
      const result = await request(path + (path.includes('?') ? '&' : '?') + 'per_page=100&page=' + page);
      if (!Array.isArray(result.data)) throw new Error('Unexpected BookNow list');
      rows.push(...result.data);
      if (!result.links?.next && !(result.meta?.current_page < result.meta?.last_page)) return rows;
    }
    throw new Error('BookNow list is too large');
  }
  return {request, list};
}
