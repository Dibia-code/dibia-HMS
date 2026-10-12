// RemoteConsoleClient — the network seam. Same async CRUD surface as
// LocalConsoleRepository (list/get/create/update/remove); implement these
// against the real platform API and swap it in RepositoryContext. Not wired
// yet (FRONTEND_SPEC §7), so each method throws loudly rather than no-op.

const NOT_WIRED = 'Platform API is not connected yet (FRONTEND_SPEC §7). Using the local console repository.'

export class RemoteConsoleClient {
  constructor({ baseUrl } = {}) {
    this.baseUrl = baseUrl || '/api'
  }

  // eslint-disable-next-line no-unused-vars
  async list(entity, opts) { throw new Error(NOT_WIRED) }
  // eslint-disable-next-line no-unused-vars
  async get(entity, id) { throw new Error(NOT_WIRED) }
  // eslint-disable-next-line no-unused-vars
  async create(entity, data) { throw new Error(NOT_WIRED) }
  // eslint-disable-next-line no-unused-vars
  async update(entity, id, patch) { throw new Error(NOT_WIRED) }
  // eslint-disable-next-line no-unused-vars
  async remove(entity, id) { throw new Error(NOT_WIRED) }
}
