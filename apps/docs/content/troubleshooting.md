---
title: Troubleshooting
description: Start with the product you're integrating — most issues are specific to RTC, Chat, or Live Streaming, not general to Raven.
---

There's no single Raven-wide troubleshooting flow, because most issues
are specific to one product's transport and guarantees:

- **[RTC → Troubleshooting](/rtc/troubleshooting)** — connection
  failures, permission errors, device issues, reconnect behavior.
- **[Chat → Troubleshooting](/chat/troubleshooting)** — duplicate
  sends, missed messages after reconnect, moderation permission errors,
  stale presence.

Live Streaming sits on both — a stream issue is almost always really an
RTC issue (host/viewer media) or a Chat issue (messages/reactions), so
start with whichever symptom you're seeing in one of the two pages
above. See [Live Streaming → Network Quality](/live-streaming/network-quality)
for the one stream-specific reconnect wrinkle (token expiry across a
reconnect).

## Still stuck?

Check [Diagnostics](/rtc/diagnostics) for RTC-side connection stats, or
[Event Catalogue](/reference/events) for what Raven itself logged
around the time of the issue.
