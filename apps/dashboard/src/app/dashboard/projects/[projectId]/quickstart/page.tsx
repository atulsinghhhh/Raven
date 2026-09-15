import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ravenApi } from '@/lib/api-client';
import { Card, CardHeader } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { IconChevronRight } from '@/components/ui/icons';
import { DOCS_URL } from '@/lib/nav';
import type { Framework } from '@/lib/integration-registry';
import { IntegrationWizard } from './integration-wizard';

/** The onboarding stack answer (step 4) is a hint, not a commitment — the
 *  wizard below is always the source of truth for what actually gets built. */
const STACK_ANSWER_TO_FRAMEWORK: Record<string, Framework> = {
  nextjs: 'nextjs',
  react: 'react',
  nodejs: 'node',
};

export default async function QuickstartPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const [project, integrations, onboarding] = await Promise.all([
    ravenApi.getProject(token, projectId),
    ravenApi.getIntegrations(token, projectId),
    ravenApi.getOnboarding(token).catch(() => undefined),
  ]);

  const defaultFramework: Framework =
    onboarding?.stack.map((s) => STACK_ANSWER_TO_FRAMEWORK[s]).find(Boolean) ?? 'nextjs';

  const base = `/dashboard/projects/${projectId}`;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader
        title="Quickstart"
        description="Pick what you're building and get an install command, environment variables, and working code for your exact stack — verified against this repository's real SDKs."
        actions={
          <ButtonLink href={`${base}/sdks`} variant="secondary">
            All SDKs
          </ButtonLink>
        }
      />

      <IntegrationWizard project={project} initialIntegrations={integrations} defaultFramework={defaultFramework} />

      <Card>
        <CardHeader
          title="Where to go next"
          subtitle="Everything below reflects code that exists in this repository."
        />
        <ul className="flex flex-col gap-2.5 text-sm">
          <NextLink href={`${base}/sdks`}>SDK reference — every real Raven package, one place</NextLink>
          <NextLink href={`${base}/rooms`}>
            Rooms — inspect live participants and mint a test token from the dashboard
          </NextLink>
          <NextLink href={`${base}/connections`}>
            Connections — every join shows up here, keyed by the <span className="font-mono text-xs">connectionId</span>{' '}
            above
          </NextLink>
          <NextLink href={`${base}/errors`}>
            Errors — categorised failures with likely cause and suggested action
          </NextLink>
          <NextLink href={`${DOCS_URL}/sdk.md`}>Full browser SDK reference (docs/sdk.md)</NextLink>
        </ul>
      </Card>
    </div>
  );
}

function NextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <a href={href} className="group inline-flex items-baseline gap-1.5 text-muted transition-colors hover:text-fg">
        <IconChevronRight className="size-3 shrink-0 translate-y-0.5 text-subtle transition-transform group-hover:translate-x-0.5" />
        <span>{children}</span>
      </a>
    </li>
  );
}
