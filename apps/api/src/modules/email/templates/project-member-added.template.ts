import { EmailBrand, RenderedEmail, renderLayout } from './layout';

export interface ProjectMemberAddedEmailInput {
  /** The person being added. */
  name: string | null;
  projectName: string;
  /** Who added them — a name if we have one, otherwise their email. */
  invitedBy: string;
  role: string;
  brand: EmailBrand;
}

/**
 * Raven has no invitation flow: `ProjectMembersService.add()` requires the
 * person to already have an account (it 404s otherwise). So this is a
 * notification of access granted, not an invitation to accept — and the
 * copy says that rather than pretending there is a pending state to
 * resolve.
 *
 * The link goes to the project *list*, not `/dashboard/projects/<uuid>`.
 * A deep link would be marginally nicer and would put an internal id in
 * an inbox, a forwarded thread, and every mail server in between, for a
 * page that is one click from the list.
 */
export function renderProjectMemberAddedEmail(input: ProjectMemberAddedEmailInput): RenderedEmail {
  const greeting = input.name ? `Hi ${input.name},` : 'Hi,';
  const role = input.role.toLowerCase();

  const { html, text } = renderLayout({
    heading: `You were added to ${input.projectName}`,
    preheader: `${input.invitedBy} added you to the Raven project ${input.projectName}.`,
    paragraphs: [
      greeting,
      `${input.invitedBy} added you to the Raven project “${input.projectName}” as ${role === 'owner' || role === 'admin' ? 'an' : 'a'} ${role}.`,
      'It is available in your dashboard now — no invitation to accept.',
    ],
    cta: { label: 'Open your projects', url: `${input.brand.appUrl}/dashboard/projects` },
    closing: 'If you did not expect this, contact the person who added you, or reach out to support.',
    brand: input.brand,
  });

  return { subject: `You were added to ${input.projectName} on Raven`, html, text };
}
