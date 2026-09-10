import { RavenMark } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The project list renders its own AccountShell, so this fallback has to
 * stand in for the chrome as well as the content: otherwise the page
 * would flash from a bare canvas to a full header. The mark and wordmark
 * are real; everything below is shaped like the grid that replaces it.
 */
export default function ProjectsLoading() {
  return (
    <div className="min-h-screen bg-canvas" aria-busy="true">
      <span className="sr-only" role="status">
        Loading projects
      </span>

      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-[85rem] items-center gap-3 px-4 lg:px-6">
          <span className="flex items-center gap-2">
            <RavenMark className="size-6" />
            <span className="text-sm font-semibold tracking-tight text-fg">Livqeno</span>
          </span>
          <div className="flex-1" />
          <Skeleton className="h-7 w-28 rounded-full" />
          <Skeleton className="size-8 rounded-md" />
        </div>
      </header>

      <div className="mx-auto flex max-w-[85rem] flex-col gap-6 px-4 py-8 lg:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="mt-2.5 h-3 w-80" />
          </div>
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="rounded-lg border border-line bg-surface p-4">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="mt-3 h-3 w-24" />
              <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                <Skeleton className="h-4 w-16 rounded-full" />
                <Skeleton className="ml-auto h-3 w-24" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
