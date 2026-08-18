import Link from 'next/link';
import { DocsNav } from '../components/DocsNav';
import { Sidebar } from '../components/Sidebar';
import { NAV } from '../lib/nav';

export default function DocsHome() {
  return (
    <>
      <DocsNav />
      <div className="mx-auto flex max-w-6xl gap-10 px-4 py-8 md:px-6 md:py-10">
        <aside className="hidden w-56 shrink-0 md:block">
          <div className="sticky top-20">
            <Sidebar />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="prose">
            <h1>Raven Documentation</h1>
            <p>
              Guides and reference for building real-time video, audio, and
              chat on Raven. Start with the quickstart if you&apos;re new — every
              other page assumes you already have a project and a token.
            </p>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {NAV.map((section) => (
              <div key={section.title} className="rounded-xl border border-line bg-surface p-5">
                <h2 className="font-semibold text-fg">{section.title}</h2>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {section.items.map((item) => (
                    <li key={item.slug}>
                      <Link href={`/${item.slug}`} className="text-accent-text hover:text-accent-hover hover:underline">
                        {item.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </main>
      </div>
    </>
  );
}
