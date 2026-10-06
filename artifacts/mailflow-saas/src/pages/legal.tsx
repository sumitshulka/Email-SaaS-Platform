import { useEffect, type ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { PublicMarketingLayout } from '@/pages/marketing';

const updated = 'October 6, 2026';

type DocumentKey = 'terms' | 'privacy' | 'shipping';
type Section = { title: string; content: ReactNode };

const pageMeta: Record<DocumentKey, { title: string; description: string; heading: string; intro: string }> = {
  terms: {
    title: 'Terms and Conditions | Mailflow',
    description: 'Read the terms for using Mailflow, including account responsibilities, paid plan terms, permitted use and service scope.',
    heading: 'Terms and Conditions',
    intro: 'The terms for using Mailflow and the workspace services provided by Taskone Solutions Pvt Ltd.',
  },
  privacy: {
    title: 'Privacy Policy | Mailflow',
    description: 'Learn what information Mailflow uses, how it supports the service, and how to submit a privacy request.',
    heading: 'Privacy Policy',
    intro: 'How Mailflow handles account, contact, campaign and service information.',
  },
  shipping: {
    title: 'Shipping & Refund Policy | Mailflow',
    description: 'Understand digital plan access and the exact eligibility requirements for Mailflow refunds.',
    heading: 'Shipping & Refund',
    intro: 'Information about digital service access, paid plan terms and refund eligibility.',
  },
};

function useLegalMeta(page: DocumentKey) {
  useEffect(() => {
    const meta = pageMeta[page];
    document.title = meta.title;
    const set = (selector: string, attr: string, value: string) => {
      let node = document.head.querySelector<HTMLMetaElement>(selector);
      if (!node) {
        node = document.createElement('meta');
        if (selector.includes('property=')) node.setAttribute('property', selector.match(/property="([^"]+)"/)?.[1] || '');
        else node.name = selector.match(/name="([^"]+)"/)?.[1] || '';
        document.head.appendChild(node);
      }
      node.setAttribute(attr, value);
    };
    set('meta[name="description"]', 'content', meta.description);
    set('meta[property="og:title"]', 'content', meta.title);
    set('meta[property="og:description"]', 'content', meta.description);
  }, [page]);
}

const termsSections: Section[] = [
  { title: '1. About these terms', content: <>These Terms and Conditions apply when you access or use Mailflow, a product of Taskone Solutions Pvt Ltd (“Taskone”, “we”, “us”). By using the service, you agree to these terms. If you use Mailflow for an organisation, you confirm that you are authorised to accept them on its behalf.</> },
  { title: '2. What Mailflow does', content: <>Mailflow provides tools for contact and company management, campaign preparation and scheduling, and sending through SMTP accounts configured by the customer. The available features may change as the service develops. Mailflow is not a substitute for your own review of recipients, message content, sender configuration or applicable requirements.</> },
  { title: '3. Eligibility and account responsibility', content: <>You must be at least 18 years old to use Mailflow. Keep your account information accurate and protect your credentials. You are responsible for activity performed through your account and for ensuring that people you authorise use it appropriately. Contact us if you believe your account has been accessed without permission.</> },
  { title: '4. Acceptable use and recipient data', content: <>Use Mailflow only for lawful purposes. You are responsible for having the rights, permissions and other lawful basis needed to collect, upload and use recipient information, and for complying with applicable privacy, marketing and anti-spam requirements. Do not use the service to send unlawful, deceptive, abusive or unsolicited messages, to compromise systems, or to interfere with other users or providers.</> },
  { title: '5. Your data and content', content: <>You retain ownership of contact data, campaign content and other material you upload or create. You allow Taskone to process that material as needed to operate and support Mailflow, including transmitting recipient and message content to the SMTP provider you choose for sending and, when enabled, sending necessary data to connected reporting or trace services. You are responsible for the accuracy and lawful use of your data.</> },
  { title: '6. Plans, payment and expiry', content: <>Paid plans are time-limited and purchased through Razorpay, our payment processor. Plans do not auto-renew for now. Plan access is restricted as soon as the purchased term expires. Payment confirmation makes plan access available; further detail is in our <Link href="/shipping-refund" data-testid="terms-refund-crosslink">Shipping &amp; Refund policy</Link>.</> },
  { title: '7. Third-party providers and sending', content: <>Sending depends on the SMTP provider you configure. Provider terms, quotas, technical limits and delivery policies apply, and providers may accept, reject, delay or otherwise handle messages under their own rules. An SMTP acceptance response does not establish inbox placement or recipient access; Mailflow does not guarantee delivery or inbox placement. Optional connected Gmail/Google Workspace or Microsoft 365 services are separate customer-connected services and may receive only data needed for enabled reporting or trace features.</> },
  { title: '8. Availability and changes', content: <>We aim to keep Mailflow useful and available, but access may occasionally be interrupted for maintenance, updates, security or circumstances outside our control. We do not promise uninterrupted availability or a particular service level. We may update these terms as the service or requirements change; the current version and its update date will appear here.</> },
  { title: '9. Intellectual property', content: <>Mailflow and its software, visual identity and service materials belong to Taskone or its licensors. These terms give you permission to use the service during your plan term, subject to these terms; they do not transfer ownership of Mailflow to you.</> },
  { title: '10. Governing law and contact', content: <>These terms are governed by the laws of India. Courts with jurisdiction in Uttar Pradesh will have jurisdiction over disputes relating to these terms, subject to applicable law. For questions, contact <a href="mailto:info@taskone.world" data-testid="terms-email">info@taskone.world</a> or use the <a href="https://www.taskone.world/contact.html" data-testid="terms-contact" target="_blank" rel="noreferrer">Taskone contact page</a>.</> },
];

const privacySections: Section[] = [
  { title: '1. Who we are', content: <>Mailflow is a product of Taskone Solutions Pvt Ltd (“Taskone”). Taskone’s business contact location is Noida, Uttar Pradesh, India. For privacy or legal questions, write to <a href="mailto:info@taskone.world" data-testid="privacy-email">info@taskone.world</a> or use the <a href="https://www.taskone.world/contact.html" data-testid="privacy-contact" target="_blank" rel="noreferrer">Taskone contact page</a>.</> },
  { title: '2. Information used by Mailflow', content: <>Depending on how you use the service, information may include account and profile details, contact and company records you add, campaign drafts and schedules, sending configuration, campaign outcomes, support communications, and technical or usage information generated while operating the service.</> },
  { title: '3. How information is used', content: <>We use information to provide and maintain Mailflow features, manage accounts and paid access, prepare and send campaigns as directed by you, record service activity and outcomes, respond to support requests, protect the service and meet applicable obligations.</> },
   { title: '4. Service providers and connected services', content: <><ul><li><strong>Razorpay:</strong> our payment processor, used to process plan payments and payment confirmations.</li><li><strong>Replit:</strong> provides application hosting and runtime infrastructure for Mailflow.</li><li><strong>Your selected SMTP provider:</strong> Mailflow transmits the recipient information and message content needed to send campaigns through the SMTP provider you configure.</li><li><strong>Optional connected Gmail/Google Workspace or Microsoft 365 services:</strong> when you enable their reporting or trace features, those customer-connected services receive only data needed for the enabled feature. These are distinct from Razorpay, which processes payments.</li><li><strong>Database and storage infrastructure:</strong> managed infrastructure services store the information needed to operate Mailflow.</li></ul>Provider terms, quotas and delivery policies apply to services you connect or use.</> },
  { title: '5. Retention and security', content: <>We retain information for as long as reasonably needed to provide and support Mailflow, maintain relevant service records, address disputes and meet applicable obligations. Retention may vary by information type and operational need. We use appropriate measures intended to protect information, while no online service can be represented as entirely risk-free.</> },
  { title: '6. Your choices and privacy requests', content: <>You are responsible for the recipient data you upload and should ensure you have an appropriate basis to use it. You may submit requests concerning personal information, including access, correction or deletion requests, via the <a href="https://www.taskone.world/contact.html" data-testid="privacy-request-contact" target="_blank" rel="noreferrer">Taskone contact page</a> or by emailing <a href="mailto:info@taskone.world" data-testid="privacy-request-email">info@taskone.world</a>. We may need information to understand and respond to a request.</> },
  { title: '7. Cookies and technical information', content: <>Mailflow may use information needed for account sessions, service operation, security and diagnostics. The exact information can depend on your browser and how you use the service. This policy does not claim that no tracking or technical logging occurs.</> },
  { title: '8. Children and policy updates', content: <>Mailflow is intended for people aged 18 or older. We do not invite minors to create accounts. We may update this policy from time to time; the current text and its last-updated date will be published on this page.</> },
  { title: '9. Applicable law', content: <>This policy is governed by the laws of India. Courts with jurisdiction in Uttar Pradesh will have jurisdiction, subject to applicable law.</> },
];

const shippingSections: Section[] = [
  { title: '1. Digital service; no physical shipping', content: <>Mailflow is a digital SaaS service. No physical items are shipped. Plan access is made available after payment confirmation.</> },
  { title: '2. Paid plan term and renewal', content: <>Paid plans are time-limited and purchased through Razorpay, our payment processor. Plans do not auto-renew for now. Account access is restricted as soon as the purchased term expires. To continue using paid features, purchase a new plan when available.</> },
  { title: '3. Refund eligibility', content: <>A refund is eligible only when both of the following conditions are met: no campaign has been processed; and the refund request is made within 7 days of payment confirmation. Both conditions are required. Requests outside either condition are not eligible under this policy.</> },
  { title: '4. Submitting a request', content: <>Submit a refund request through the <a href="https://www.taskone.world/contact.html" data-testid="refund-contact" target="_blank" rel="noreferrer">Taskone contact page</a> or email <a href="mailto:info@taskone.world" data-testid="refund-email">info@taskone.world</a>. Include the account email and payment confirmation details so the request can be identified. Razorpay processes payments; any eligible refund is handled using the applicable payment process.</> },
  { title: '5. Contact and governing law', content: <>Mailflow is a product of Taskone Solutions Pvt Ltd. These policy terms are governed by the laws of India, with courts having jurisdiction in Uttar Pradesh, subject to applicable law.</> },
];

const sections: Record<DocumentKey, Section[]> = { terms: termsSections, privacy: privacySections, shipping: shippingSections };

function LegalPage({ page }: { page: DocumentKey }) {
  useLegalMeta(page);
  const meta = pageMeta[page];
  return <PublicMarketingLayout>
    <main className="legal-page">
      <div className="legal-topline"><span>MAILFLOW / TRUST &amp; POLICIES</span><Link href="/" data-testid="legal-home-link">Back to overview <ArrowRight size={14}/></Link></div>
      <header className="legal-heading">
        <div className="legal-kicker"><span/>TASKONE SOLUTIONS PVT LTD</div>
        <h1 data-testid={`heading-${page}`}>{meta.heading}</h1>
        <p>{meta.intro}</p>
        <div className="legal-updated"><span>Last updated</span><time dateTime="2026-10-06">{updated}</time></div>
      </header>
      <aside className="legal-disclaimer" data-testid="legal-disclaimer">
        <strong>Important note</strong>
        <p>This policy text is general and informational, not legal advice. Please have it reviewed by qualified counsel for your circumstances.</p>
      </aside>
      <div className="legal-content-layout">
        <nav className="legal-toc" aria-label="Related policies">
          <span>RELATED POLICIES</span>
          <Link href="/terms-and-conditions" data-testid="legal-link-terms">Terms and Conditions</Link>
          <Link href="/privacy-policy" data-testid="legal-link-privacy">Privacy Policy</Link>
          <Link href="/shipping-refund" data-testid="legal-link-shipping">Shipping &amp; Refund</Link>
          <a href="https://www.taskone.world/contact.html" data-testid="legal-link-contact" target="_blank" rel="noreferrer">Contact Us <ArrowUpRight size={13}/></a>
        </nav>
        <div className="legal-sections">
          {sections[page].map((section, index) => <section key={section.title} data-testid={`legal-section-${page}-${index + 1}`}>
            <h2>{section.title}</h2><div className="legal-copy">{section.content}</div>
          </section>)}
          <div className="legal-publisher">
            <span>Published by</span><strong>Taskone Solutions Pvt Ltd</strong>
            <p>For legal and privacy enquiries: <a href="mailto:info@taskone.world" data-testid={`legal-publisher-email-${page}`}>info@taskone.world</a></p>
          </div>
        </div>
      </div>
      <style>{`
        .legal-page{width:min(1060px,calc(100% - 48px));margin:0 auto;padding:31px 0 108px;color:#213148}
        .legal-topline{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #dfe5e7;padding:0 0 18px;color:#778493;font:500 10px 'DM Mono',monospace;letter-spacing:.12em}
        .legal-topline a{display:inline-flex;align-items:center;gap:7px;color:#2865ae;font:600 12px 'Plus Jakarta Sans',sans-serif;letter-spacing:0}
        .legal-heading{max-width:770px;padding:62px 0 28px}
        .legal-kicker{display:flex;align-items:center;gap:9px;color:#527491;font:500 10px 'DM Mono',monospace;letter-spacing:.14em}
        .legal-kicker span{width:20px;height:1px;background:#e34c55}
        .legal-heading h1{margin:18px 0 13px;color:#142035;font-size:clamp(38px,6vw,60px);letter-spacing:-.065em;line-height:1.04}
        .legal-heading>p{max-width:650px;margin:0;color:#687789;font-size:15px;line-height:1.85}
        .legal-updated{display:flex;gap:9px;margin-top:24px;color:#748193;font-size:11px}.legal-updated time{color:#34465e;font-weight:700}
        .legal-disclaimer{display:flex;gap:15px;align-items:flex-start;padding:17px 20px;margin:0 0 38px;border:1px solid #e7d7bb;border-left:3px solid #d18a42;border-radius:4px;background:#f8f4eb;color:#665238}
        .legal-disclaimer strong{white-space:nowrap;font-size:12px}.legal-disclaimer p{margin:0;font-size:12px;line-height:1.75}
        .legal-content-layout{display:grid;grid-template-columns:210px minmax(0,1fr);gap:76px;align-items:start}
        .legal-toc{position:sticky;top:25px;display:grid;gap:13px;padding:19px 0;border-top:1px solid #dfe5e7}
        .legal-toc>span{margin-bottom:3px;color:#8792a0;font:500 9px 'DM Mono',monospace;letter-spacing:.13em}
        .legal-toc a{display:flex;align-items:center;justify-content:space-between;color:#57677a;font-size:11px;font-weight:600;line-height:1.55}.legal-toc a:hover,.legal-copy a,.legal-publisher a{color:#2865ae}
        .legal-sections>section{padding:0 0 28px;margin:0 0 27px;border-bottom:1px solid #e2e7e8}
        .legal-sections h2{margin:0 0 11px;color:#1b2c43;font-size:18px;letter-spacing:-.035em}
        .legal-copy{color:#596a7c;font-size:13px;line-height:1.9}.legal-copy p{margin:0}.legal-copy ul{padding-left:19px;margin:0}.legal-copy li{padding-left:3px;margin:0 0 10px}.legal-copy li:last-child{margin-bottom:0}.legal-copy strong{color:#2b3c52}
        .legal-copy a,.legal-publisher a{text-decoration:underline;text-underline-offset:3px}
        .legal-publisher{padding:19px 21px;border:1px solid #dfe5e7;background:#eef2f1;border-radius:4px}
        .legal-publisher>span{display:block;margin-bottom:6px;color:#778493;font:500 9px 'DM Mono',monospace;letter-spacing:.13em;text-transform:uppercase}
        .legal-publisher strong{color:#1c3049;font-size:14px}.legal-publisher p{margin:8px 0 0;color:#657588;font-size:11px}
        @media(max-width:720px){.legal-page{width:calc(100% - 38px);padding:23px 0 70px}.legal-topline{font-size:8px}.legal-heading{padding:43px 0 24px}.legal-heading>p{font-size:13px}.legal-disclaimer{display:block;padding:14px 15px}.legal-disclaimer strong{display:block;margin-bottom:5px}.legal-content-layout{grid-template-columns:1fr;gap:30px}.legal-toc{position:static;grid-template-columns:1fr 1fr;gap:11px 18px;padding:14px 0}.legal-toc>span{grid-column:1/-1}.legal-sections h2{font-size:16px}.legal-copy{font-size:12px}}
      `}</style>
  </main></PublicMarketingLayout>;
}

export function TermsAndConditionsPage() { return <LegalPage page="terms"/>; }
export function PrivacyPolicyPage() { return <LegalPage page="privacy"/>; }
export function ShippingRefundPage() { return <LegalPage page="shipping"/>; }
