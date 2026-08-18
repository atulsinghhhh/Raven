import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui/button';
import { IconFolder, RavenMark } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/states';
import { DOCS_URL } from '@/lib/nav';

export const metadata: Metadata = {
  title: 'Page not found — Raven',
};

/**
 * Root 404. Renders outside every shell, so it carries its own mark and
 * routes back to the one place that is always valid for a signed-in
 * developer: their project list.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex justify-center">
          <span className="flex items-center gap-2">
            <RavenMark className="size-7" />
            <span className="text-base font-semibold tracking-tight text-fg">Raven</span>
          </span>
        </div>

        <div className="mt-7">
          <EmptyState
            icon={<IconFolder className="size-7" />}
            title="404 — page not found"
            description="This URL doesn't match anything in the console. It may have been renamed, or the project or record it pointed at no longer exists."
            action={
              <>
                <ButtonLink href="/dashboard/projects" variant="primary">
                  Back to projects
                </ButtonLink>
                <ButtonLink href={DOCS_URL} target="_blank" rel="noreferrer" variant="secondary">
                  Documentation
                </ButtonLink>
              </>
            }
          />
        </div>
      </div>
    </main>
  );
}
