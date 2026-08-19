'use client';

import { CodeBlock } from './CodeBlock';
import { useInView } from '../lib/useInView';

const MESSAGES = [
  { from: 'Alice', text: 'Are we still shipping today?', receipt: 'read' as const },
  { from: 'Bob', text: 'Yes. Everything is ready.', receipt: 'read' as const },
  { from: 'Alice', text: 'Perfect.', receipt: 'delivered' as const },
];

const CODE = `import { createChatClient } from '@corvidhq/chat';

const chat = createChatClient({ token: resp.token });

await chat.connect({ room: conversation.publicId });
await chat.sendMessage({ text: 'Hello everyone!' });

chat.on('message', (msg) => console.log(msg.senderId, msg.text));`;

const RECEIPT_LABEL: Record<'sent' | 'delivered' | 'read', string> = {
  sent: '✓',
  delivered: '✓✓',
  read: '✓✓',
};

/** Chat's half of the "Products" trio — a static thread, one bubble typing. */
export function ChatSection() {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <section className="border-t border-line py-24">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2 md:items-center">
        <div className="order-2 md:order-1">
          <div ref={ref} className="rounded-(--radius-panel) border border-line bg-surface p-6">
            <div className="border-b border-line pb-4">
              <span className="font-mono text-sm text-muted">support-room-42</span>
            </div>
            <ul className="mt-4 flex flex-col gap-3">
              {MESSAGES.map((m, i) => (
                <li
                  key={i}
                  className="flex flex-col gap-1 transition-all duration-500"
                  style={{
                    opacity: inView ? 1 : 0,
                    transform: inView ? 'none' : 'translateY(6px)',
                    transitionDelay: `${i * 180}ms`,
                    alignItems: m.from === 'Alice' ? 'flex-start' : 'flex-end',
                  }}
                >
                  <span className="text-xs font-medium text-subtle">{m.from}</span>
                  <span
                    className={`max-w-[80%] rounded-(--radius-panel) px-3.5 py-2 text-sm ${
                      m.from === 'Alice' ? 'bg-surface-raised text-fg' : 'bg-accent text-accent-fg'
                    }`}
                  >
                    {m.text}
                  </span>
                  <span
                    className={`text-[11px] tabular ${
                      m.receipt === 'read' ? 'text-accent-text' : 'text-subtle'
                    }`}
                  >
                    {RECEIPT_LABEL[m.receipt]}
                  </span>
                </li>
              ))}
              <li
                className="flex items-center gap-1 rounded-(--radius-panel) bg-surface-raised px-3.5 py-2.5 transition-all duration-500"
                style={{
                  opacity: inView ? 1 : 0,
                  transitionDelay: `${MESSAGES.length * 180}ms`,
                  alignSelf: 'flex-start',
                }}
                aria-label="Bob is typing"
              >
                <span className="raven-typing-dot h-1.5 w-1.5 rounded-full bg-subtle" />
                <span className="raven-typing-dot h-1.5 w-1.5 rounded-full bg-subtle" />
                <span className="raven-typing-dot h-1.5 w-1.5 rounded-full bg-subtle" />
              </li>
            </ul>
          </div>
        </div>

        <div className="order-1 md:order-2">
          <span className="mono-label text-[12px] text-accent-text">Chat</span>
          <h2 className="mt-2 text-3xl font-light tracking-tight text-fg md:text-4xl">
            Messaging that feels instant.
          </h2>
          <p className="mt-4 text-muted">
            Conversations, presence, typing, and receipts — with idempotent sends and cursor-based pagination
            underneath, so a retried request never double-posts a message.
          </p>
          <div className="mt-6">
            <CodeBlock filename="chat.js" code={CODE} />
          </div>
        </div>
      </div>

      <style>{`
        .raven-typing-dot { animation: raven-typing 1.1s ease-in-out infinite; }
        .raven-typing-dot:nth-child(2) { animation-delay: 0.15s; }
        .raven-typing-dot:nth-child(3) { animation-delay: 0.3s; }
        @keyframes raven-typing {
          0%, 60%, 100% { opacity: 0.35; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-2px); }
        }
      `}</style>
    </section>
  );
}
