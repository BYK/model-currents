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

`week` is the Monday UTC date. Each count is the number of observed session starts or model changes to that model in that week, not turns or tokens. The weekly format carries **no** event timestamps, prompts, replies, paths, source names, session IDs, or message IDs. Uploads require `Content-Type: application/vnd.model-tides.weekly+json`, `Content-Encoding: br`, and `X-Model-Tides-Schema: weekly-v1`. The Worker rejects extra fields, invalid weeks, excessive counts, compressed uploads over 64 KiB, and expanded JSON over 512 KiB. It allows up to 520 weeks, 2,048 model-week cells, and 10,000 events in one cell. Only names listed in the current [models.dev](https://models.dev/) model and provider catalogs can be uploaded. The browser and CLI retrieve the public registry without sending local history or model names, omit unlisted names from the consent preview, and keep them in the private timeline. The Worker checks every uploaded name again before writing counts; if registry verification is unavailable, sharing stops without writing.

`POST /api/contributions` creates a public UUIDv7 ID and returns a separate private 256-bit replacement token. `PUT /api/contributions/:id` replaces the named weeks when authorized with `Authorization: Bearer <token>`; it never adds counts from repeat uploads. `DELETE /api/contributions/:id` deletes the contribution and `POST /api/contributions/:id/rotate` rotates the key. The Worker stores only a SHA-256 hash of the token. `GET /api/contributions/:id`, `/u/:id`, and `/og/:id.png` are public. `GET /api/aggregate` and `/og/global.png` omit model-week cells with fewer than five contributors. The global figures are self-reported and cannot prove that different public IDs represent different people.

The [local metadata format](MODEL-TIDES.md) contains exact event timestamps and is meant for private transfer. It is never an upload format. The browser and CLI derive weekly snapshots locally and ask for explicit consent before uploading them.
