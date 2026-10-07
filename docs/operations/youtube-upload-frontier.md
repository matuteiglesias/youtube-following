# Known-channel upload frontier

## Current provider evidence

On 2026-10-07, direct requests to the documented YouTube Atom topic
`https://www.youtube.com/feeds/videos.xml?channel_id=<UC...>` returned HTTP 404
for multiple real public channel IDs, including the Google Developers, Fireship,
3Blue1Brown, and other public-channel fixtures used during diagnosis. The response
was from the YouTube RSS Feeds server and did not reach application code. This is
an upload-frontier provider outage/compatibility failure, not a ChannelResolver
failure.

Atom remains useful when available: it is public, zero Data API quota, and returns
only discovery hints. It is not canonical video metadata. Media Monitor remains
the only path used to canonicalize a newly discovered video.

## v1 repair

The runtime frontier is now:

```text
Atom/RSS primary
  ├─ success → UploadHint[]
  └─ bounded 404/429/5xx/timeout
       └─ YouTube Data API fallback
            channels.list(part=contentDetails,id=UC...)
              → contentDetails.relatedPlaylists.uploads
            playlistItems.list(part=snippet,contentDetails,playlistId=...)
              → UploadHint[]
```

The fallback is composable behind the existing `UploadFrontierProvider`. It only
accepts an already-known canonical `UC...` channel ID, returns the same
`UploadHint` shape, and does not write product state or canonical video metadata.
D6 still calls Media Monitor only for unseen video IDs and never calls summary
generation.

When `YOUTUBE_API_KEY` is absent, the runtime constructs the Atom-only provider.
That preserves the keyless known-channel path when Atom is healthy. If Atom is
unavailable without a key, the bounded provider failure is returned and D6 applies
its existing per-channel retry/isolation behavior.

Malformed successful Atom content does not trigger the fallback. This avoids
turning arbitrary HTML or parser failures into unbounded API traffic. Data API
errors are also bounded and never expose provider payloads or credentials.

## Alternatives considered

- **Atom only:** low cost but currently fails closed during the observed 404 outage.
- **Atom primary + Data API fallback:** smallest repair; preserves keyless normal
  operation and adds an official recovery path. Selected for v1.
- **Data API primary:** reliable official path but spends two quota units per
  channel check and makes normal hourly polling expensive at scale. Not selected.
- **WebSub:** near-real-time push is attractive, but requires callback lifecycle,
  renewal, replay/reconciliation, and state. D-011 remains unchanged; revisit only
  at the documented scale/backlog trigger.
- **Scraping/undocumented endpoints:** rejected as brittle and outside the v1
  provider contract.

## Quota model

The official `channels.list` and `playlistItems.list` read methods each cost one
quota unit. A Data API fallback therefore costs two units per channel check when
the uploads playlist ID is not cached. Under hourly checks:

| Active channels | Atom-only normal day | API primary: 2 × channels × 24 | Atom + API fallback during full outage |
| ---: | ---: | ---: | ---: |
| 30 | 0 | 1,440 | 1,440 |
| 150 | 0 | 7,200 | 7,200 |
| 1,000 | 0 | 48,000 | 48,000 |

The default YouTube project quota is 10,000 units/day for the general Data API
bucket. The selected design therefore keeps the API off the normal path and does
not hide a 1,000-channel outage problem behind an unbounded retry loop.

Caching the uploads playlist ID could reduce steady-state API polling to one
`playlistItems.list` call per channel/hour, but it would require product-state
schema/authority work that is not necessary for the bounded v1 fallback. Revisit
that cache together with the D-011 scale decision rather than adding it as an
incidental provider field.

## Official references

- [YouTube push notifications/WebSub](https://developers.google.com/youtube/v3/guides/push_notifications)
- [channels.list and uploads playlist](https://developers.google.com/youtube/v3/docs/channels)
- [playlistItems.list](https://developers.google.com/youtube/v3/docs/playlistItems/list)
- [YouTube quota costs](https://developers.google.com/youtube/v3/determine_quota_cost)
