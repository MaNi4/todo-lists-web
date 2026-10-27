// The encrypted file in a private GitHub repository, through the REST API
// (the same calls as bin/todo-lists in the plugin). Only the encrypted file
// is ever sent; the token goes in the Authorization header.

const API = "https://api.github.com"

export class GitHubError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export function githubMessage(status, data) {
  const message = String((data && data.message) || "").slice(0, 200)
  if (status === 401) return "GitHub refused the token (expired or wrong)"
  if (status === 403 || status === 404) return "GitHub: no access to that repository or file with this token" + (message ? ` (${message})` : "")
  return `GitHub answered ${status} ${message}`
}

function utf8ToB64(text) {
  const bytes = new TextEncoder().encode(text)
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function b64ToUtf8(b64) {
  const s = atob(String(b64).replace(/\s+/g, ""))
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export class GitHub {
  constructor(repo, path, token) {
    this.repo = repo
    this.path = path
    this.token = token
  }

  async request(method, url, body, etag) {
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + this.token,
      "X-GitHub-Api-Version": "2022-11-28",
    }
    if (etag) headers["If-None-Match"] = etag
    if (body) headers["Content-Type"] = "application/json"
    // Network errors (offline) throw a TypeError, which the caller tells apart.
    const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" })
    let data = {}
    if (r.status !== 304) {
      try { data = await r.json() } catch { data = {} }
    }
    return { status: r.status, data, etag: r.headers.get("ETag") }
  }

  contentsUrl() {
    const path = this.path.split("/").map(encodeURIComponent).join("/")
    return `${API}/repos/${this.repo}/contents/${path}`
  }

  async repoInfo() {
    const { status, data } = await this.request("GET", `${API}/repos/${this.repo}`)
    if (status !== 200) throw new GitHubError(githubMessage(status, data), status)
    return data
  }

  // {status: 200, env, sha, etag} | {status: 304} | {status: 404}
  async fetchFile(etag) {
    const { status, data, etag: tag } = await this.request("GET", this.contentsUrl(), null, etag)
    if (status === 304 || status === 404) return { status }
    if (status !== 200) throw new GitHubError(githubMessage(status, data), status)
    let content = data.content
    if (data.encoding !== "base64" || typeof content !== "string") {
      // Past 1 MB the contents API leaves the content out; read the blob.
      const blob = await this.request("GET", `${API}/repos/${this.repo}/git/blobs/${data.sha}`)
      if (blob.status !== 200) throw new GitHubError(githubMessage(blob.status, blob.data), blob.status)
      content = blob.data.content || ""
    }
    return { status, env: JSON.parse(b64ToUtf8(content)), sha: data.sha, etag: tag }
  }

  // {status}: 200/201 written, 409/422 changed there meanwhile.
  async putFile(env, sha) {
    const body = { message: "Update to-do lists", content: utf8ToB64(JSON.stringify(env) + "\n") }
    if (sha) body.sha = sha
    const { status, data } = await this.request("PUT", this.contentsUrl(), body)
    if (![200, 201, 409, 422].includes(status)) throw new GitHubError(githubMessage(status, data), status)
    return { status }
  }
}
