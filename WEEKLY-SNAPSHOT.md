# Model Tides weekly snapshot (v1)

Opt-in contributions use this JSON, compressed with Brotli in transit:

```json
{
  "format": "model-tides-weekly",
  "version": 1,
  "weeks": [
    { "week": "2026-09-28", "models": { "anthropic/claude-sonnet-4": 2, "openai/gpt-5": 1 } }
  ]
}
```

`week` is the Monday UTC date. Each count is the number of observed session starts or model changes to that model in that week, not turns or tokens. The weekly format carries **no** event timestamps, prompts, replies, paths, source names, session IDs, or message IDs. Uploads require `Content-Type: application/vnd.model-tides.weekly+json`, `Content-Encoding: br`, and `X-Model-Tides-Schema: weekly-v1`; new uploads also require `X-Model-Tides-Report: private-v1`. Older clients that cannot distinguish private upload from public sharing receive 426 before the body is read. The Worker rejects extra fields, invalid weeks, excessive counts, compressed uploads over 64 KiB, and expanded JSON over 512 KiB. It allows up to 520 weeks, 2,048 model-week cells, and 10,000 events in one cell. Browser and CLI previews show every model name and count that will be uploaded, including older names absent from current catalogs. The Worker validates each name's length and characters, but cannot verify self-reported model use.

`POST /api/contributions` creates a UUIDv7 ID and a separate private 256-bit owner token. New contributions count toward the aggregate but have no public personal page. `POST /api/contributions/:id/share` publishes the personal report; `POST /api/contributions/:id/unshare` hides it again. Both require `Authorization: Bearer <token>`. Existing reports stay public after the visibility migration unless the owner hides them. `GET /api/contributions/:id`, `/u/:id`, and `/og/:id.png` return 404 while the report is hidden; authenticated owners can read their own counts through the API. `PUT /api/contributions/:id` replaces named weeks instead of adding counts from repeat uploads and preserves current visibility. `DELETE /api/contributions/:id` removes all counts; `POST /api/contributions/:id/rotate` rotates the key. The Worker stores only a SHA-256 hash of the token. `GET /api/aggregate` and `/og/global.png` omit model-week cells with fewer than five contributors, regardless of personal report visibility. The global figures are self-reported and cannot prove that different IDs represent different people.

The [local metadata format](MODEL-TIDES.md) contains exact event timestamps and is meant for private transfer. It is never an upload format. The browser and CLI derive weekly snapshots locally and ask for explicit consent before uploading them. The optional `model-tides gist` command sends only the same reviewed weekly JSON to an unlisted GitHub gist after separate consent; unlisted gists are readable by anyone with the URL and retain revisions.
