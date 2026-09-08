// Minimal backend for a frontend that joins Raven RTC rooms: the canonical
// Phase 10 flow: Browser -> your backend -> @corvidhq/server -> Raven -> a
// short-lived RTC token -> back to the browser -> @corvidhq/rtc.
//
// RAVEN_API_KEY never leaves this process. Never send it to the browser.
import express from 'express';
import { Raven, RavenError } from '@corvidhq/server';

const raven = new Raven({
  apiKey: process.env.RAVEN_API_KEY,
  baseUrl: process.env.RAVEN_API_URL, // defaults to http://localhost:4100 if unset
});

const app = express();
app.use(express.json());

app.post('/api/rtc/token', async (req, res) => {
  const { room, identity } = req.body ?? {};
  if (!room || !identity) {
    res.status(400).json({ error: 'room and identity are required' });
    return;
  }

  // In a real app, `identity` should come from your own authenticated
  // session (req.user.id), never trusted verbatim from the request body;
  // see docs/security/server-sdk.md#authorization-model. Kept simple here
  // to focus the example on the Raven SDK call itself.
  try {
    const token = await raven.tokens.create({
      room,
      identity,
      permissions: { join: true, subscribe: true, publish: true, publishAudio: true, publishVideo: true },
      expiresIn: 3600,
    });
    res.json(token);
  } catch (error) {
    if (error instanceof RavenError) {
      console.error(`Raven token creation failed [${error.code}] (request ${error.requestId ?? 'n/a'})`);
      res.status(error.statusCode ?? 502).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }
});

const port = process.env.PORT ?? 8787;
app.listen(port, () => {
  console.log(`Raven node-server example listening on http://localhost:${port}`);
});
