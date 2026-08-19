// Ad-hoc baseline: unauthenticated /health/live throughput, to isolate
// whether ApiKeyAuthGuard's per-request bcrypt.compare() (not DB/network/
// generator capacity) is the authenticated-REST-surface bottleneck.
// See docs/production/capacity-report.md.
import http from 'k6/http';
export const options = {
  stages: [
    { duration: '10s', target: 50 },
    { duration: '15s', target: 50 },
    { duration: '5s', target: 0 },
  ],
};
export default function () {
  http.get(`${__ENV.TARGET}/health/live`, { tags: { name: 'health_live' } });
}
