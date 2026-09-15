import { redirect } from 'next/navigation';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card, SectionHeader, StatCard } from '@/components/ui/card';
import { IconShield } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/page-header';
import { Dash, EmptyState, ErrorState } from '@/components/ui/states';
import { MobileField, MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount } from '@/lib/format';
import { getSessionToken } from '@/lib/session';
import { getSecurity, type RiskLevel, type SecurityOverview } from '@/lib/super-admin/ops';
import { ApiError } from '@/lib/super-admin-client';

/**
 * Security surface (spec §16). The risk-indicator table renders the
 * deterministic LOW/MEDIUM/HIGH/CRITICAL levels `SecurityService`
 * computes with fixed rules — explicitly not a model. See that file's
 * doc comment for the exact thresholds; the `reasons` column here is
 * that same logic's plain-language explanation, not a re-derivation.
 */

const RISK_TONE: Record<RiskLevel, BadgeTone> = {
  LOW: 'neutral',
  MEDIUM: 'warning',
  HIGH: 'warning',
  CRITICAL: 'danger',
};

const RISK_ORDER: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export default async function SuperAdminSecurityPage() {
  const token = await getSessionToken();
  if (!token) redirect('/login?next=/super-admin/security');

  let data: SecurityOverview | null = null;
  let loadError: ApiError | null = null;

  try {
    data = await getSecurity(token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/login?next=/super-admin/security');
    if (err instanceof ApiError) {
      loadError = err;
    } else {
      throw err;
    }
  }

  const base = '/super-admin/security';

  if (loadError) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Security" eyebrow="Operations" />
        {loadError.status === 403 ? (
          <EmptyState
            title="You don't have access to Security"
            description="Reading the platform security surface requires Super Admin Portal access."
            icon={<IconShield className="size-6" />}
          />
        ) : (
          <ErrorState
            title="Could not load security data"
            description="The Control API is unreachable right now. Retry in a moment."
            retryHref={base}
          />
        )}
      </div>
    );
  }

  if (!data) return null;

  const sortedRisks = [...data.riskIndicators].sort((a, b) => RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Security"
        eyebrow="Operations"
        description="Failed logins, suspicious activity, lockouts and revoked keys, read directly from the ActivityEvent stream — plus a deterministic, rule-based risk indicator per developer."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Failed logins"
          value={formatCount(data.failedLogins.today)}
          hint={`${formatCount(data.failedLogins.thisWeek)} this week`}
        />
        <StatCard
          label="Suspicious activity"
          value={formatCount(data.suspiciousActivity.today)}
          hint={`${formatCount(data.suspiciousActivity.thisWeek)} this week`}
        />
        <StatCard
          label="Lockouts"
          value={formatCount(data.accountLockouts.today)}
          hint={`${formatCount(data.accountLockouts.currentlySuspended)} currently suspended`}
        />
        <StatCard
          label="Revoked API keys"
          value={formatCount(data.revokedApiKeys.today)}
          hint={`${formatCount(data.revokedApiKeys.thisWeek)} this week`}
        />
        <StatCard
          label="Rate-limit violations"
          value={formatCount(data.rateLimitViolations.today)}
          hint={`${formatCount(data.rateLimitViolations.thisWeek)} this week`}
        />
        <StatCard
          label="Admin security events"
          value={formatCount(data.adminSecurityEvents.today)}
          hint={`${formatCount(data.adminSecurityEvents.thisWeek)} this week`}
        />
      </div>

      <section>
        <SectionHeader
          title="Risk indicators"
          subtitle="Every developer with at least one security-relevant event in the last 24 hours, ranked by a fixed rule set — not a model."
        />

        {sortedRisks.length === 0 ? (
          <EmptyState
            title="No elevated risk right now"
            description="No developer has had a failed login, suspicious-activity, rate-limit, suspension, or API-key-revocation event in the last 24 hours."
            icon={<IconShield className="size-6" />}
          />
        ) : (
          <>
            <TableWrap className="hidden sm:block">
              <Table>
                <THead>
                  <TH>Developer</TH>
                  <TH align="right">Risk</TH>
                  <TH align="right">Failed logins (24h)</TH>
                  <TH align="right">Suspicious/rate-limit (7d)</TH>
                  <TH>Why</TH>
                </THead>
                <TBody>
                  {sortedRisks.map((r) => (
                    <TR key={r.developerId}>
                      <TD>
                        {r.email ? <span className="text-sm text-fg">{r.email}</span> : <Dash />}
                        <div className="font-mono text-[11px] text-subtle">{r.developerId}</div>
                      </TD>
                      <TD align="right">
                        <Badge tone={RISK_TONE[r.riskLevel]}>{r.riskLevel}</Badge>
                      </TD>
                      <TD align="right">
                        <span className="tabular font-mono text-sm text-fg">{formatCount(r.loginFailedCount24h)}</span>
                      </TD>
                      <TD align="right">
                        <span className="tabular font-mono text-sm text-fg">
                          {formatCount(r.suspiciousOrRateLimitCount7d)}
                        </span>
                      </TD>
                      <TD>
                        <span className="text-xs text-muted">{r.reasons.join('; ')}</span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>

            <div className="sm:hidden">
              <MobileList>
                {sortedRisks.map((r) => (
                  <MobileRow key={r.developerId}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <span className="text-xs font-medium text-fg">{r.email ?? r.developerId}</span>
                      <Badge tone={RISK_TONE[r.riskLevel]}>{r.riskLevel}</Badge>
                    </div>
                    <MobileField label="Failed logins (24h)">{formatCount(r.loginFailedCount24h)}</MobileField>
                    <MobileField label="Suspicious/rate-limit (7d)">
                      {formatCount(r.suspiciousOrRateLimitCount7d)}
                    </MobileField>
                    <p className="mt-2 text-xs text-muted">{r.reasons.join('; ')}</p>
                  </MobileRow>
                ))}
              </MobileList>
            </div>
          </>
        )}
      </section>

      <Card className="text-xs text-subtle">
        Risk rules: CRITICAL = suspended in the last 24h. HIGH = 5+ failed logins in 24h. MEDIUM = any
        suspicious-activity or rate-limit event in the last 7 days. LOW = has a recent security event but matches none
        of the above. Deterministic rules only, by design — no ML model.
      </Card>
    </div>
  );
}
