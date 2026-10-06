import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import {
  ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleAlert, Clock3,
  ContactRound, Gauge, Layers3, ListChecks, Mail, Menu, Send, Search, SlidersHorizontal,
  ShieldCheck, Sparkles, X,
} from 'lucide-react';
import { useListAvailableSubscriptionPackages } from '@workspace/api-client-react';
import { MailflowBrand } from '@/components/brand';
import type { SubscriptionPackage } from '@workspace/api-client-react';

const homeMeta = {
  title: 'Mailflow — thoughtful email marketing, in your hands',
  description: 'Bring contacts, companies, lists and campaigns into one clear workspace. Send through your own SMTP accounts and review campaign history with Mailflow.',
};
const pricingMeta = {
  title: 'Mailflow pricing — plans for your next send',
  description: 'Explore Mailflow plans for organizing contacts and preparing email campaigns. See current plan limits and pricing, with no invented numbers.',
};
const featuresMeta = {
  title: 'Email marketing features for small teams | Mailflow',
  description: 'Organize contacts, plan campaigns and send through the SMTP account you control. See how Mailflow keeps email marketing clear and straightforward.',
};

function usePageMeta(meta: typeof homeMeta) {
  useEffect(() => {
    document.title = meta.title;
    const setMeta = (selector: string, attribute: string, value: string) => {
      let element = document.head.querySelector<HTMLMetaElement>(selector);
      if (!element) {
        element = document.createElement('meta');
        if (selector.includes('property=')) element.setAttribute('property', selector.match(/property="([^"]+)"/)?.[1] || '');
        else element.name = selector.match(/name="([^"]+)"/)?.[1] || '';
        document.head.appendChild(element);
      }
      element.setAttribute(attribute, value);
    };
    setMeta('meta[name="description"]', 'content', meta.description);
    setMeta('meta[property="og:title"]', 'content', meta.title);
    setMeta('meta[property="og:description"]', 'content', meta.description);
  }, [meta]);
}

function Header({ active }: { active: 'home' | 'pricing' | 'features' | 'legal' }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="mf-header">
      <div className="mf-nav-wrap">
        <Link href="/" className="mf-brand-link" data-testid="link-brand-home" aria-label="Mailflow home"><MailflowBrand /></Link>
        <button className="mf-menu-toggle" type="button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} data-testid="button-mobile-menu" onClick={() => setOpen(v => !v)}>
          {open ? <X /> : <Menu />}
        </button>
        <nav className={`mf-nav ${open ? 'is-open' : ''}`} aria-label="Main navigation">
          <Link href="/" data-testid="nav-home" aria-current={active === 'home' ? 'page' : undefined} onClick={() => setOpen(false)}>Overview</Link>
          <Link href="/features" data-testid="nav-features" aria-current={active === 'features' ? 'page' : undefined} onClick={() => setOpen(false)}>Features</Link>
          <Link href="/pricing" data-testid="nav-pricing" aria-current={active === 'pricing' ? 'page' : undefined} onClick={() => setOpen(false)}>Pricing</Link>
          <span className="mf-nav-spacer" />
          <Link href="/login" className="mf-login" data-testid="nav-login" onClick={() => setOpen(false)}>Log in</Link>
          <Link href="/register" className="mf-button mf-button-small" data-testid="nav-register" onClick={() => setOpen(false)}>Get started <ArrowRight size={15}/></Link>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mf-footer">
      <div className="mf-footer-main">
        <div>
          <Link href="/" className="mf-brand-link" data-testid="footer-brand"><MailflowBrand /></Link>
          <p>Email marketing with a little more room to think.</p>
        </div>
        <div className="mf-footer-links">
          <div><span className="mf-footer-label">Explore</span><Link href="/" data-testid="footer-home">Overview</Link><Link href="/features" data-testid="footer-features">Features</Link><Link href="/pricing" data-testid="footer-pricing">Pricing</Link><Link href="/terms-and-conditions" data-testid="footer-terms">Terms and Conditions</Link><Link href="/privacy-policy" data-testid="footer-privacy">Privacy Policy</Link><Link href="/shipping-refund" data-testid="footer-shipping-refund">Shipping &amp; Refund</Link></div>
          <div><span className="mf-footer-label">Your workspace</span><Link href="/register" data-testid="footer-register">Create an account</Link><Link href="/login" data-testid="footer-login">Log in</Link><a href="https://www.taskone.world/contact.html" data-testid="footer-contact" target="_blank" rel="noreferrer">Contact Us</a></div>
        </div>
      </div>
      <div className="mf-footer-bottom"><span>Mailflow</span><span>Mailflow is a product of Taskone Solutions Pvt Ltd.</span><a href="#top" data-testid="link-back-to-top">Back to top <ArrowDown size={13}/></a></div>
    </footer>
  );
}

export function PublicMarketingLayout({ children }: { children: ReactNode }) {
  return <div className="mf-site" id="top"><Header active="legal"/>{children}<Footer/><Styles/></div>;
}

function MetaLayout({ children, active }: { children: ReactNode; active: 'home' | 'pricing' | 'features' }) {
  return <div className="mf-site" id="top"><Header active={active}/>{children}<Footer/><Styles/></div>;
}

function HeroIllustration() {
  return (
    <div className="mf-hero-visual" aria-label="Illustration of a Mailflow campaign workspace">
      <div className="mf-visual-topline"><span><span className="mf-live-dot"/> WORKSPACE PREVIEW / CAMPAIGNS</span><span>EXAMPLE ACTIVITY</span></div>
      <div className="mf-dashboard">
        <aside className="mf-mini-sidebar">
          <span className="mf-sidebar-mark"><Mail size={15}/></span>
          <span className="mf-sidebar-item active"><Gauge size={16}/></span>
          <span className="mf-sidebar-item"><ContactRound size={16}/></span>
          <span className="mf-sidebar-item"><Layers3 size={16}/></span>
          <span className="mf-sidebar-item"><Send size={16}/></span>
        </aside>
        <div className="mf-dash-main">
          <div className="mf-dash-heading"><div><span className="mf-tiny-label">YOUR WORKSPACE</span><h3>Campaigns</h3></div><span className="mf-dash-avatar">J</span></div>
          <div className="mf-dash-summary">
            <div><span>Campaigns</span><strong>Drafting</strong><small>Ready when you are</small></div>
            <div><span>Campaign history</span><strong>Recent sends</strong><small>Review by audience</small></div>
            <div><span>Sending account</span><strong>Connected</strong><small className="mf-account-ok"><span/> SMTP setup</small></div>
          </div>
          <div className="mf-campaign-card">
            <div className="mf-list-head"><span>WORKSPACE PREVIEW</span><span>CAMPAIGNS <ArrowUpRight size={11}/></span></div>
            <div className="mf-campaign-row"><span className="mf-row-icon blue"><Mail size={14}/></span><span className="mf-row-copy"><b>April studio notes</b><small>Spring clients · Apr 08</small></span><span className="mf-status">Completed</span></div>
            <div className="mf-campaign-row"><span className="mf-row-icon coral"><Clock3 size={14}/></span><span className="mf-row-copy"><b>New season, new work</b><small>Prospects · Apr 04</small></span><span className="mf-status status-draft">Draft</span></div>
            <div className="mf-campaign-row"><span className="mf-row-icon pale"><ListChecks size={14}/></span><span className="mf-row-copy"><b>March round-up</b><small>All subscribers · Mar 27</small></span><span className="mf-status">Completed</span></div>
          </div>
        </div>
      </div>
      <div className="mf-float-note"><span className="mf-note-icon"><ShieldCheck size={15}/></span><span><b>Your account, your sender</b><small>SMTP connection checked</small></span><Check size={15}/></div>
      <div className="mf-orbit orbit-one"/><div className="mf-orbit orbit-two"/>
    </div>
  );
}

function SectionEyebrow({ children }: { children: ReactNode }) {
  return <div className="mf-eyebrow"><span/> {children}</div>;
}

export function MarketingHomePage() {
  usePageMeta(homeMeta);
  return (
    <MetaLayout active="home">
      <main>
        <section className="mf-hero">
          <div className="mf-hero-grid">
            <div className="mf-hero-copy">
              <SectionEyebrow>Email marketing, thoughtfully arranged</SectionEyebrow>
              <h1>Make every<br/><em>send</em> feel considered.</h1>
              <p className="mf-hero-lede">The calm, capable workspace for your contacts, companies, lists and campaigns. You bring the audience and your SMTP account. Mailflow brings it all together.</p>
              <div className="mf-hero-actions"><Link href="/register" className="mf-button" data-testid="hero-get-started">Make room to grow <ArrowRight size={17}/></Link><Link href="/pricing" className="mf-text-link" data-testid="hero-view-pricing">See plans <ArrowUpRight size={16}/></Link></div>
              <div className="mf-hero-footnote"><span className="mf-check-ring"><Check size={12}/></span> Your sending account stays yours <span className="mf-foot-divider"/> SMTP outcomes, clearly explained</div>
            </div>
            <HeroIllustration />
          </div>
          <div className="mf-hero-bottom"><span>BUILT FOR SMALL TEAMS WITH SOMETHING TO SAY</span><a href="#how-it-works" data-testid="link-scroll-story">See how it flows <ArrowDown size={14}/></a></div>
        </section>

        <section className="mf-intro mf-section-wrap" id="how-it-works">
          <div className="mf-intro-aside"><SectionEyebrow>One clear place</SectionEyebrow><span className="mf-index">01 / THE WORKSPACE</span></div>
          <div className="mf-intro-copy"><h2>Less tab-juggling.<br/><span>More good work.</span></h2><p>Marketing shouldn’t mean rebuilding the same context in five places. Keep the people, the plan and the send close together—so the work feels easier to pick up and easier to follow through.</p><Link href="/register" className="mf-underlined-link" data-testid="intro-create-account">Set up your workspace <ArrowRight size={15}/></Link></div>
          <div className="mf-route-graphic" aria-hidden="true"><div className="route-label">A BETTER ROUTE THROUGH EMAIL</div><div className="route-line"><i/><i/><i/><span><ArrowRight size={20}/></span></div><div className="route-steps"><span>Know your people</span><span>Shape your message</span><span>Understand the outcome</span></div></div>
        </section>

        <section className="mf-feature-section">
          <div className="mf-section-wrap">
            <div className="mf-section-heading"><div><SectionEyebrow>Everything in its right place</SectionEyebrow><h2>A steady rhythm<br/>from list to send.</h2></div><p>Useful structure for the whole campaign process, without turning your day into a project plan.</p></div>
            <div className="mf-feature-grid">
              <article className="mf-feature feature-wide">
                <span className="mf-feature-number">01</span><div className="mf-feature-icon"><ContactRound size={21}/></div>
                <h3>Know the people behind the email.</h3><p>Keep contacts, company details and the context your team needs in one organized place. Bring in existing contacts and shape useful lists for the next conversation.</p>
                <div className="mf-contact-preview"><div className="mf-preview-head"><span>CONTACTS · EXAMPLE</span><span>COMPANY + LIST</span></div><div className="mf-contact-line"><span className="mf-initials">AM</span><span><b>Alex Morgan</b><small>Northstar Studio</small></span><span className="mf-tag">Customer</span></div><div className="mf-contact-line"><span className="mf-initials warm">JL</span><span><b>Jamie Lee</b><small>Fieldwork Co.</small></span><span className="mf-tag tag-warm">Prospect</span></div><div className="mf-contact-line"><span className="mf-initials lilac">RC</span><span><b>Riley Chen</b><small>Independent</small></span><span className="mf-tag">Subscriber</span></div></div>
              </article>
              <article className="mf-feature">
                <span className="mf-feature-number">02</span><div className="mf-feature-icon icon-coral"><Layers3 size={21}/></div>
                <h3>Make the next send a little easier.</h3><p>Build campaigns around a clear audience. Draft the message, choose a list and keep your progress visible before anything leaves your workspace.</p>
                <div className="mf-composer"><div className="composer-top"><span className="composer-dot"/><span className="composer-dot"/><span className="composer-dot"/><span>NEW CAMPAIGN</span></div><div className="composer-field">To <b>Spring clients <span>128 contacts</span></b></div><div className="composer-field">Subject <b>A note for the new season</b></div><div className="composer-body"><i/><i/><i/></div><div className="composer-action">Save draft <ArrowRight size={12}/></div></div>
              </article>
              <article className="mf-feature">
                <span className="mf-feature-number">03</span><div className="mf-feature-icon icon-cream"><Gauge size={21}/></div>
                <h3>See what happened, clearly.</h3><p>Review campaign history and the SMTP outcomes Mailflow can observe. Keep your records useful and your expectations grounded.</p>
                <div className="mf-outcome"><div className="outcome-title"><span>EXAMPLE · APRIL STUDIO NOTES</span><span className="mf-status">COMPLETED</span></div><div className="outcome-stats"><div><b>Audience</b><small>Selected list</small></div><div><b>Accepted</b><small>SMTP response</small></div><div><b>Review</b><small>Campaign record</small></div></div><div className="outcome-foot"><span><Check size={12}/> SMTP server accepted</span><span>Not an inbox receipt</span></div></div>
              </article>
            </div>
          </div>
        </section>

        <section className="mf-principles">
          <div className="mf-section-wrap principles-layout">
            <div className="principles-intro"><SectionEyebrow>Confidence, without the fog</SectionEyebrow><h2>Built around the way your email actually works.</h2><p>Mailflow helps you prepare and manage campaigns. Your configured SMTP account handles sending; its responses tell you what the server accepted or rejected.</p></div>
            <div className="principle-list">
              <article><span className="principle-index">A</span><div><h3>Your SMTP. Your setup.</h3><p>Connect the sending account you configure and keep sender details in your own hands.</p></div><ArrowUpRight size={18}/></article>
              <article><span className="principle-index">B</span><div><h3>A record you can return to.</h3><p>Campaign history makes previous work and recorded sending outcomes easier to review.</p></div><ArrowUpRight size={18}/></article>
              <article><span className="principle-index">C</span><div><h3>Honest about the last mile.</h3><p>SMTP acceptance is a server response, not confirmation that a message reached an inbox.</p></div><ArrowUpRight size={18}/></article>
            </div>
          </div>
        </section>

        <section className="mf-final-cta"><div className="cta-route" aria-hidden="true"><span/><span/><span/></div><div className="mf-final-inner"><SectionEyebrow>A good place to start</SectionEyebrow><h2>Bring your next<br/>campaign into focus.</h2><p>Set up your workspace, connect a sending account and get your audience in order.</p><Link href="/register" className="mf-button mf-button-light" data-testid="final-register">Start with Mailflow <ArrowRight size={17}/></Link><span className="cta-note">No invented promises. Just a clearer way to work.</span></div><div className="cta-side-note">MAILFLOW / 02<br/><span>THE ROUTE IS YOURS</span></div></section>
      </main>
    </MetaLayout>
  );
}

function FeatureAudiencePreview() {
  return <div className="ft-audience-window" aria-label="Example searchable contact list">
    <div className="ft-window-bar"><span className="ft-window-dots"><i/><i/><i/></span><span>CONTACTS / ALL PEOPLE</span><span className="ft-window-count">FILTERS <SlidersHorizontal size={11}/></span></div>
    <div className="ft-search"><Search size={13}/> Search contacts, companies or fields <span>⌘ K</span></div>
    <div className="ft-table-head"><span>CONTACT</span><span>COMPANY</span><span>LEAD STATUS</span></div>
    <div className="ft-person-row"><span className="ft-avatar">AM</span><span><b>Alex Morgan</b><small>alex@northstar.studio</small></span><span>Northstar Studio</span><em>Customer</em></div>
    <div className="ft-person-row"><span className="ft-avatar ft-avatar-peach">JL</span><span><b>Jamie Lee</b><small>jamie@fieldwork.co</small></span><span>Fieldwork Co.</span><em className="ft-prospect">Prospect</em></div>
    <div className="ft-person-row"><span className="ft-avatar ft-avatar-sage">RC</span><span><b>Riley Chen</b><small>riley@independent.design</small></span><span>Independent</span><em>Subscriber</em></div>
    <div className="ft-window-footer"><span>Showing a filtered view</span><span>Export contacts <ArrowUpRight size={11}/></span></div>
  </div>;
}

function FeatureCampaignPreview() {
  return <div className="ft-campaign-window" aria-label="Example campaign planning preview">
    <div className="ft-campaign-window-head"><span><span className="ft-campaign-mark"><Mail size={13}/></span> New campaign</span><span className="ft-draft-badge">DRAFT</span></div>
    <div className="ft-campaign-field"><small>CAMPAIGN OBJECTIVE</small><b>Share the new season collection</b><span>Give this send a clear purpose.</span></div>
    <div className="ft-campaign-field ft-audience-field"><small>CONTACT LISTS <span>2 selected</span></small><div><span className="ft-list-check"><Check size={10}/></span><b>Spring clients</b><span>Priority 1</span></div><div><span className="ft-list-check"><Check size={10}/></span><b>Studio subscribers</b><span>Priority 2</span></div></div>
    <div className="ft-audience-count"><span>Audience preview</span><b>One clear audience</b><small>Duplicate email addresses across selected lists receive one email.</small></div>
    <div className="ft-preview-actions"><span>Preview audience &amp; template <ArrowUpRight size={12}/></span><span>Queue or schedule <ArrowRight size={12}/></span></div>
  </div>;
}

export function PublicFeaturesPage() {
  usePageMeta(featuresMeta);
  return <MetaLayout active="features">
    <main className="mf-features-page">
      <section className="ft-hero">
        <div className="ft-hero-wrap">
          <div className="ft-hero-copy">
            <SectionEyebrow>THE FEATURES / MADE PRACTICAL</SectionEyebrow>
            <p className="ft-hero-index">A SMALL-TEAM WORKSPACE · 01—06</p>
            <h1>Email marketing<br/>that stays <em>in your hands.</em></h1>
            <p className="ft-hero-lede">Keep your people, campaign plan and sending account in one clear place. Mailflow gives a small team a steadier way to get a send ready—without moving into a separate bulk-mail provider.</p>
            <div className="mf-hero-actions"><Link href="/register" className="mf-button" data-testid="features-hero-register">Make a little room <ArrowRight size={16}/></Link><a href="#features-workflow" className="mf-text-link" data-testid="features-scroll-workflow">Explore the workflow <ArrowDown size={15}/></a></div>
            <div className="ft-hero-note"><ShieldCheck size={16}/> Your configured SMTP account does the sending.</div>
          </div>
          <div className="ft-hero-art" aria-label="Mailflow campaign prep, from audience to your own sender">
            <div className="ft-art-label"><span>MAILFLOW / THE SENDING ROUTE</span><span>YOU STAY IN CONTROL</span></div>
            <div className="ft-route-stage">
              <div className="ft-route-card ft-route-audience"><span className="ft-route-icon"><ContactRound size={17}/></span><span><small>01 / AUDIENCE</small><b>Your people, in order</b><em>Contacts · Companies · Lists</em></span><Check size={15}/></div>
              <div className="ft-route-connector"><i/><i/><i/></div>
              <div className="ft-route-card ft-route-campaign"><span className="ft-route-icon"><Layers3 size={17}/></span><span><small>02 / CAMPAIGN</small><b>A clear plan to review</b><em>Objective · Preview · Schedule</em></span><Check size={15}/></div>
              <div className="ft-route-connector"><i/><i/><i/></div>
              <div className="ft-route-card ft-route-smtp"><span className="ft-route-icon"><Send size={17}/></span><span><small>03 / SENDING</small><b>Your SMTP account</b><em>Configured by your team</em></span><span className="ft-connected">CONNECTED</span></div>
            </div>
            <div className="ft-hero-callout"><span className="ft-callout-line"/><span>Mailflow coordinates the work.<br/><b>Your provider’s rules still apply.</b></span></div>
            <div className="ft-art-caption"><span>ONE SIMPLE ROUTE</span><span>NO BULK-PLATFORM MOVE-IN</span></div>
          </div>
        </div>
        <div className="ft-hero-bottom"><span>PEOPLE FIRST. SENDING ACCOUNT YOURS.</span><a href="#features-audience" data-testid="features-scroll-audience">Start with the audience <ArrowDown size={13}/></a></div>
      </section>

      <section className="ft-thesis" data-testid="features-thesis">
        <div className="mf-section-wrap ft-thesis-inner"><span className="ft-thesis-kicker">A DIFFERENT KIND OF EMAIL WORKSPACE</span><p>Bring the email address and SMTP account you already control. <em>Keep the campaign work simple.</em></p><span className="ft-thesis-end">NO PROVIDER MOVE-IN<br/>NO OPERATIONS MAZE</span></div>
      </section>

      <section className="ft-audience-section" id="features-audience">
        <div className="mf-section-wrap ft-audience-layout">
          <div className="ft-section-copy">
            <SectionEyebrow>01 / KNOW YOUR PEOPLE</SectionEyebrow><h2>Useful context,<br/><em>not another spreadsheet.</em></h2>
            <p>Keep contacts connected to company profiles, add custom contact fields, and use search, filters and contact lists to find the right people.</p>
            <ul className="ft-check-list"><li><Check size={14}/> Search and filter contact and company records.</li><li><Check size={14}/> Export contact or company data for your records.</li><li><Check size={14}/> Keep lead-status changes with reason, actor and date.</li></ul>
            <div className="ft-audience-foot"><span className="ft-field-chip">CUSTOM FIELDS</span><span className="ft-field-chip">LEAD HISTORY</span><span className="ft-field-chip">CONTACT &amp; COMPANY EXPORTS</span></div>
          </div>
          <div className="ft-preview-stage"><div className="ft-preview-label"><span>WORKSPACE PREVIEW</span><span>CONTACTS / EXAMPLE</span></div><FeatureAudiencePreview/><div className="ft-history-note"><span className="ft-history-pin"><Clock3 size={13}/></span><span><b>Lead status updated</b><small>Reason, who changed it, and when are kept with the history.</small></span><ArrowUpRight size={13}/></div></div>
        </div>
      </section>

      <section className="ft-campaign-section" id="features-workflow">
        <div className="mf-section-wrap">
          <div className="ft-campaign-intro"><div><SectionEyebrow>02 / PLAN THE SEND</SectionEyebrow><h2>One campaign.<br/><em>A few clear decisions.</em></h2></div><p>Build around an objective, choose the audience and sender, then check the details before you queue or schedule.</p></div>
          <div className="ft-campaign-layout"><FeatureCampaignPreview/><div className="ft-campaign-steps">
            <article><span>01</span><div><h3>Give it a purpose.</h3><p>Write down the campaign objective so your team knows what this send is for.</p></div></article>
            <article><span>02</span><div><h3>Choose lists, in order.</h3><p>Select one or more contact lists and set their processing priority. Duplicate addresses across those lists receive one email.</p></div></article>
            <article><span>03</span><div><h3>Review, then decide when.</h3><p>Preview the audience and template, then queue delivery or schedule it for later.</p></div></article>
            <div className="ft-no-journeys"><span className="ft-no-journeys-dot"/><span><b>Straightforward by design</b><small>A clear campaign workflow—not a behavioral or drip-journey builder.</small></span></div>
          </div></div>
          <div className="ft-campaign-bottom"><span>MAKE THE DECISIONS THAT MATTER.</span><span>LEAVE THE REST OUT OF THE WAY.</span></div>
        </div>
      </section>

      <section className="ft-sender-section">
        <div className="mf-section-wrap ft-sender-layout">
          <div className="ft-sender-heading"><SectionEyebrow>03 / YOUR SENDER, YOUR CALL</SectionEyebrow><h2>Keep your email<br/><em>address where it belongs.</em></h2><p>Mailflow doesn’t ask you to move into a separate bulk-email transport provider. Configure the SMTP account you control, check the connection, and send yourself a test email.</p><Link href="/register" className="ft-underlined-cta" data-testid="features-sender-register">Set up your workspace <ArrowRight size={15}/></Link></div>
          <div className="ft-sender-panel">
            <div className="ft-sender-panel-head"><span><ShieldCheck size={15}/> SENDING ACCOUNT</span><span className="ft-sender-status"><i/> CONNECTION CHECKED</span></div>
            <div className="ft-sender-identity"><div className="ft-sender-avatar"><Mail size={19}/></div><span><small>SENDER IDENTITY</small><b>hello@yourstudio.example</b><em>Your name · Reply-to set by you</em></span><Check size={16}/></div>
            <div className="ft-sender-fields"><div><small>SMTP HOST</small><b>smtp.your-provider.example</b></div><div><small>CONNECTION</small><b><span/> Ready to test</b></div></div>
            <div className="ft-sender-buttons"><span>Check connection</span><span>Send a test email <ArrowRight size={12}/></span></div>
            <div className="ft-sender-multi"><span className="ft-multi-icon"><Layers3 size={15}/></span><span><b>More than one sender?</b><small>Set up multiple SMTP accounts within your subscription allowance, then pick a sender for each campaign.</small></span></div>
          </div>
        </div>
        <div className="mf-section-wrap ft-sending-boundary"><span className="ft-boundary-icon"><ShieldCheck size={16}/></span><p><b>A clear sending boundary.</b> Mailflow manages the audience and campaign workflow; your configured SMTP account sends. Provider rules, quotas and deliverability limits still apply. An SMTP server accepting a message does not confirm inbox placement.</p></div>
      </section>

      <section className="ft-history-section">
        <div className="mf-section-wrap ft-history-layout">
          <div><SectionEyebrow>04 / A RECORD TO RETURN TO</SectionEyebrow><h2>Know what the<br/><em>server told you.</em></h2><p>Campaign history keeps persisted outcomes with the work, so you can review what was queued and what your configured sending account reported.</p><div className="ft-honesty"><span><Check size={13}/></span><p>SMTP acceptance is not inbox confirmation. Mailflow keeps that distinction clear.</p></div></div>
          <div className="ft-history-card">
            <div className="ft-history-card-head"><span>CAMPAIGN HISTORY · EXAMPLE</span><span>APRIL 08 <ArrowDown size={11}/></span></div>
            <div className="ft-history-campaign"><span className="ft-history-campaign-icon"><Mail size={16}/></span><span><b>April studio notes</b><small>Spring clients · Sender: hello@yourstudio.example</small></span><span className="ft-history-done">COMPLETED</span></div>
            <div className="ft-history-divider"/>
            <div className="ft-outcome-row"><span className="ft-outcome-check"><Check size={11}/></span><span><b>SMTP response recorded</b><small>Server accepted the message</small></span><time>10:42</time></div>
            <div className="ft-outcome-row ft-outcome-muted"><span className="ft-outcome-symbol">—</span><span><b>Inbox placement</b><small>Not confirmed by SMTP acceptance</small></span><span className="ft-not-reported">NOT REPORTED</span></div>
            <div className="ft-history-card-bottom"><span>OUTCOME PERSISTED WITH CAMPAIGN</span><span>OPEN HISTORY <ArrowUpRight size={11}/></span></div>
          </div>
        </div>
      </section>

      <section className="ft-faq-section">
        <div className="mf-section-wrap ft-faq-layout"><div><SectionEyebrow>GOOD TO KNOW</SectionEyebrow><h2>Helpful clarity<br/>before you begin.</h2></div><div className="faq-items">
          <details><summary data-testid="feature-faq-transport">Does Mailflow provide bulk email sending? <ChevronDown size={17}/></summary><p>No. Mailflow manages contacts, the campaign workflow and its recorded outcomes. Delivery uses the SMTP account you configure, and provider quotas, rules and deliverability limits apply.</p></details>
          <details><summary data-testid="feature-faq-automation">Does Mailflow run automatic drip journeys? <ChevronDown size={17}/></summary><p>Mailflow offers a straightforward campaign process: select lists, set priority, preview the audience and template, then queue or schedule delivery. It is not an automatic behavioral journey builder.</p></details>
          <details><summary data-testid="feature-faq-reporting">Does an accepted SMTP response mean the email arrived? <ChevronDown size={17}/></summary><p>No. Acceptance is the sending server’s response, not confirmation that a message reached an inbox. Optional Gmail or Microsoft reporting also depends on provider and administrator configuration.</p></details>
        </div></div>
      </section>
      <section className="ft-final-cta"><div className="ft-final-orbit" aria-hidden="true"><i/><i/><i/></div><div className="ft-final-inner"><SectionEyebrow>A CLEARER WAY TO GET READY</SectionEyebrow><h2>Keep the work close.<br/><em>Keep the sender yours.</em></h2><p>Start with your contacts, your plan and an SMTP account you control.</p><div><Link href="/register" className="mf-button mf-button-light" data-testid="features-final-register">Get started with Mailflow <ArrowRight size={16}/></Link><Link href="/pricing" className="ft-final-pricing" data-testid="features-final-pricing">See plans <ArrowUpRight size={14}/></Link></div><span className="ft-final-foot">YOUR PROVIDER'S RULES AND LIMITS STILL APPLY.</span></div><span className="ft-final-index">MAILFLOW / FEATURES</span></section>
    </main>
  </MetaLayout>;
}

function formatMoney(pkg: SubscriptionPackage) {
  const digits = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: pkg.currency,
  }).resolvedOptions().maximumFractionDigits ?? 2;
  const amount = pkg.amountMinor / (10 ** digits);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: pkg.currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${pkg.currency} ${amount.toFixed(digits)}`;
  }
}

function PackageCard({ pkg, index }: { pkg: SubscriptionPackage; index: number }) {
  const cadence = pkg.periodDays === 1 ? 'per day' : pkg.periodDays === 7 ? 'per week' : pkg.periodDays === 30 ? 'per month' : pkg.periodDays === 365 ? 'per year' : `per ${pkg.periodDays} days`;
  return (
    <article className={`mf-plan-card ${index === 1 ? 'plan-featured' : ''}`} data-testid={`card-package-${pkg.id}`}>
      <div className="plan-card-top"><span className="plan-overline">{String(index + 1).padStart(2, '0')} / MAILFLOW PLAN</span>{index === 1 && <span className="plan-featured-tag">A LITTLE MORE ROOM</span>}</div>
      <h2>{pkg.name}</h2>
      <p className="plan-description">{pkg.description || 'A considered plan for your contacts and campaigns.'}</p>
      <div className="plan-price"><strong>{formatMoney(pkg)}</strong><span>{cadence}</span></div>
      <div className="plan-rule"/>
      <div className="plan-includes">IN THIS PLAN</div>
      <ul className="plan-limits">
        <li><span className="limit-icon"><ContactRound size={15}/></span><span>Up to <b>{pkg.contactLimit.toLocaleString()}</b> contacts</span></li>
        <li><span className="limit-icon"><Mail size={15}/></span><span><b>{pkg.emailAccountLimit.toLocaleString()}</b> SMTP sender {pkg.emailAccountLimit === 1 ? 'account' : 'accounts'}</span></li>
        <li><span className="limit-icon"><Clock3 size={15}/></span><span>Plan period: <b>{pkg.periodDays} {pkg.periodDays === 1 ? 'day' : 'days'}</b></span></li>
      </ul>
      <Link href="/register" className={`mf-button plan-button ${index === 1 ? 'button-navy' : 'button-outline'}`} data-testid={`package-cta-${pkg.id}`}>Get started <ArrowRight size={16}/></Link>
      <p className="plan-footnote">Sending uses your configured SMTP account.</p>
    </article>
  );
}

function PricingContent() {
  const packagesQuery = useListAvailableSubscriptionPackages();
  const packages = packagesQuery.data?.packages ?? [];
  return (
    <main className="mf-pricing-main">
      <section className="mf-pricing-hero">
        <div className="pricing-hero-kicker"><SectionEyebrow>Plans made clear</SectionEyebrow><span>01—03 / PRICING</span></div>
        <h1>Room to grow.<br/><em>Nothing to guess.</em></h1>
        <p>Choose a plan based on the workspace you need today. Every figure below comes from the currently available Mailflow plans.</p>
        <a href="#available-plans" className="mf-pricing-scroll" data-testid="link-scroll-pricing">Explore available plans <ArrowDown size={15}/></a>
        <div className="mf-price-decoration" aria-hidden="true"><span>MAILFLOW</span><i/><i/><i/><b><ArrowRight size={21}/></b></div>
      </section>
      <section className="mf-plan-section" id="available-plans">
        <div className="mf-section-wrap">
          <div className="mf-plan-heading"><div><SectionEyebrow>Available plans</SectionEyebrow><h2>Find your starting point.</h2></div><p>Limits and prices are shown as configured. Plans may be updated by the Mailflow team.</p></div>
          {packagesQuery.isLoading ? <div className="mf-plans-skeleton" aria-label="Loading available plans"><div/><div/><div/></div> :
            packagesQuery.isError ? <div className="mf-pricing-state error-state" role="alert"><span className="state-icon"><CircleAlert size={21}/></span><div><h3>Plans aren’t available right now.</h3><p>We couldn’t load the current plan list. Please try again.</p></div><button type="button" className="mf-button button-outline retry-button" data-testid="button-retry-packages" onClick={() => packagesQuery.refetch()}>Try again <ArrowRight size={15}/></button></div> :
              packages.length === 0 ? <div className="mf-pricing-state empty-state"><span className="state-icon"><Sparkles size={20}/></span><div><h3>No plans are available just now.</h3><p>Available plans are managed by the Mailflow team. Please check back soon.</p></div></div> :
                <div className="mf-plan-grid">{packages.map((pkg, index) => <PackageCard key={pkg.id} pkg={pkg} index={index}/>)}</div>}
          <div className="mf-pricing-note"><ShieldCheck size={17}/><p>Your sending account is configured separately. Mailflow records SMTP outcomes; an accepted message is not the same as confirmed inbox delivery.</p></div>
        </div>
      </section>
      <section className="mf-pricing-bottom"><div><span className="mf-small-label">STILL FINDING YOUR FEET?</span><h2>Start with the people<br/>you already know.</h2><p>Build your workspace around real contacts, companies and campaign plans.</p></div><Link href="/register" className="mf-button" data-testid="pricing-bottom-register">Create your account <ArrowRight size={16}/></Link></section>
      <section className="mf-pricing-faq"><div className="mf-section-wrap faq-layout"><div><SectionEyebrow>Good to know</SectionEyebrow><h2>A few useful<br/>clarifications.</h2></div><div className="faq-items"><details><summary data-testid="faq-sending-service">Does Mailflow include a sending service?<ChevronDown size={17}/></summary><p>Mailflow campaigns are sent using your configured SMTP account. You choose and set up the sending provider.</p></details><details><summary data-testid="faq-campaign-outcome">What does a campaign outcome tell me?<ChevronDown size={17}/></summary><p>Mailflow can show recorded SMTP outcomes, such as accepted or rejected responses. SMTP acceptance does not confirm that a message reached a recipient’s inbox.</p></details><details><summary data-testid="faq-plan-limits">Where do the listed plan limits come from?<ChevronDown size={17}/></summary><p>The plans shown above are loaded from the current public plan list. The Mailflow team manages which plans are available.</p></details></div></div></section>
    </main>
  );
}

export function PublicPricingPage() {
  usePageMeta(pricingMeta);
  return <MetaLayout active="pricing"><PricingContent/></MetaLayout>;
}

function Styles() {
  return <style>{`
    .mf-site{--navy:#142035;--navy2:#1c2d49;--blue:#2865ae;--blue-dark:#1d4f8b;--red:#e34c55;--ink:#1d2b40;--body:#667487;--paper:#f6f7f4;--line:#dfe5e7;--mist:#eaf0f4;color:var(--ink);background:var(--paper);font-family:'Plus Jakarta Sans',sans-serif;overflow:hidden}
    .mf-site *{box-sizing:border-box}.mf-site a{color:inherit;text-decoration:none}.mf-header{height:78px;position:relative;z-index:30;border-bottom:1px solid rgba(20,32,53,.08);background:rgba(248,249,246,.92);backdrop-filter:blur(14px)}.mf-nav-wrap{width:min(1220px,calc(100% - 64px));height:100%;margin:auto;display:flex;align-items:center;justify-content:space-between}.mf-brand-link{display:inline-flex;align-items:center}.mf-brand-link .display{font-family:'Plus Jakarta Sans',sans-serif}.mf-nav{display:flex;align-items:center;gap:34px;height:100%;font-size:13px;font-weight:600;color:#536174}.mf-nav>a:not(.mf-button){transition:color .18s ease}.mf-nav>a[aria-current=page],.mf-nav>a:not(.mf-button):hover{color:var(--blue)}.mf-nav-spacer{width:30px}.mf-login{margin-right:-12px}.mf-menu-toggle{display:none}.mf-button{display:inline-flex;align-items:center;justify-content:center;gap:11px;min-height:51px;padding:0 21px;border:1px solid var(--blue);border-radius:5px;background:var(--blue);color:white!important;font-size:13px;font-weight:700;letter-spacing:-.01em;transition:background .2s ease,transform .2s ease,border-color .2s ease}.mf-button:hover{background:var(--blue-dark);border-color:var(--blue-dark);transform:translateY(-2px)}.mf-button:focus-visible,.mf-site a:focus-visible,.mf-site button:focus-visible{outline:3px solid rgba(40,101,174,.32);outline-offset:3px}.mf-button-small{min-height:41px;padding:0 16px;font-size:12px}.mf-section-wrap{width:min(1150px,calc(100% - 64px));margin:0 auto}.mf-hero{position:relative;padding:82px 0 0;background:#f6f7f4;min-height:632px}.mf-hero-grid{width:min(1220px,calc(100% - 64px));margin:auto;display:grid;grid-template-columns:.94fr 1.06fr;align-items:center;gap:20px}.mf-hero-copy{padding:17px 0 54px;position:relative;z-index:2}.mf-eyebrow{display:flex;align-items:center;gap:9px;color:#456f9c;font:500 10px 'DM Mono',monospace;letter-spacing:.13em;text-transform:uppercase}.mf-eyebrow>span{display:inline-block;width:20px;height:1px;background:var(--red)}.mf-hero h1,.mf-pricing-hero h1{margin:25px 0 20px;font-size:clamp(52px,6.3vw,83px);line-height:.99;letter-spacing:-.075em;font-weight:700;color:var(--navy)}.mf-hero h1 em,.mf-pricing-hero h1 em{font-style:normal;color:var(--blue);position:relative}.mf-hero h1 em:after{content:"";position:absolute;height:5px;width:74%;bottom:-6px;left:4px;background:var(--red);transform:rotate(-2deg);opacity:.9}.mf-hero-lede{max-width:480px;color:var(--body);font-size:15px;line-height:1.9;margin:0}.mf-hero-actions{display:flex;align-items:center;gap:27px;margin-top:29px}.mf-text-link,.mf-underlined-link{display:inline-flex;align-items:center;gap:9px;font-size:13px;font-weight:700;color:var(--navy);transition:color .15s}.mf-text-link:hover,.mf-underlined-link:hover{color:var(--blue)}.mf-hero-footnote{display:flex;align-items:center;gap:9px;color:#718091;font-size:10px;margin-top:27px}.mf-check-ring{border:1px solid #b8c6cc;color:#326f71;border-radius:50%;width:17px;height:17px;display:grid;place-items:center}.mf-foot-divider{height:13px;border-left:1px solid #cad1d4;margin:0 2px}.mf-hero-visual{position:relative;isolation:isolate;min-height:430px;margin:0 -10px 4px 0;padding:34px 10px 29px 30px}.mf-hero-visual:before{content:"";position:absolute;inset:0 10px 8px 15px;background:#e8eef0;border-radius:48% 0 0 0;z-index:-2}.mf-hero-visual:after{content:"";position:absolute;z-index:-1;width:180px;height:180px;border-radius:50%;right:12px;top:6px;background:#dce8eb}.mf-visual-topline{display:flex;justify-content:space-between;align-items:center;padding:0 17px 11px;color:#788696;font:9px 'DM Mono',monospace;letter-spacing:.08em}.mf-live-dot{display:inline-block;width:6px;height:6px;background:#60a287;border-radius:50%;margin-right:7px}.mf-dashboard{position:relative;z-index:1;display:flex;min-height:332px;background:#fff;border:1px solid #d9e1e5;border-radius:8px;overflow:hidden;box-shadow:0 22px 48px rgba(29,48,70,.12);transform:rotate(-1.1deg)}.mf-mini-sidebar{width:48px;flex:none;border-right:1px solid #edf0f1;background:#f9faf9;display:flex;align-items:center;flex-direction:column;padding:12px 0;gap:15px}.mf-sidebar-mark{height:24px;width:24px;border-radius:6px;display:grid;place-items:center;background:var(--navy);color:white;margin-bottom:8px}.mf-sidebar-item{width:27px;height:27px;color:#98a3ad;display:grid;place-items:center;border-radius:6px}.mf-sidebar-item.active{background:#eaf1fa;color:var(--blue)}.mf-dash-main{padding:21px 22px 17px;flex:1;min-width:0}.mf-dash-heading{display:flex;align-items:center;justify-content:space-between}.mf-tiny-label{display:block;color:#8b96a2;font:8px 'DM Mono',monospace;letter-spacing:.1em}.mf-dash-heading h3{margin:4px 0 0;font-size:18px;letter-spacing:-.05em;color:var(--navy)}.mf-dash-avatar{width:27px;height:27px;border-radius:50%;display:grid;place-items:center;background:#f4e7df;color:#a35f49;font-size:10px;font-weight:700}.mf-dash-summary{display:grid;grid-template-columns:repeat(3,1fr);margin:17px 0 14px;border:1px solid #e9edef;border-radius:5px}.mf-dash-summary>div{padding:11px 11px 10px;border-right:1px solid #e9edef}.mf-dash-summary>div:last-child{border:0}.mf-dash-summary span{display:block;font-size:8px;color:#7e8995}.mf-dash-summary strong{display:block;margin:5px 0 3px;color:var(--navy);font-size:22px;letter-spacing:-.06em}.mf-dash-summary small{font-size:7px;color:#9aa3ad}.mf-dash-summary .mf-account-ok{display:flex;align-items:center;gap:4px;color:#54816d}.mf-account-ok span{width:5px;height:5px;border-radius:50%;background:#66a27e}.mf-campaign-card{border:1px solid #e9edef;border-radius:5px;padding:11px 12px 0}.mf-list-head{display:flex;align-items:center;justify-content:space-between;color:#929da8;font:8px 'DM Mono',monospace;letter-spacing:.06em;padding:0 0 8px;border-bottom:1px solid #edf0f1}.mf-list-head span:last-child{display:flex;align-items:center;gap:3px;color:#6685a6}.mf-campaign-row{height:54px;display:flex;align-items:center;gap:9px;border-bottom:1px solid #f0f2f3}.mf-campaign-row:last-child{border:0}.mf-row-icon{width:27px;height:27px;border-radius:6px;display:grid;place-items:center}.mf-row-icon.blue{color:#4273ad;background:#eaf1f8}.mf-row-icon.coral{color:#bd7762;background:#f8ede8}.mf-row-icon.pale{color:#78849b;background:#f0f1ee}.mf-row-copy{min-width:0;flex:1}.mf-row-copy b,.mf-row-copy small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mf-row-copy b{font-size:9px;color:#334156;font-weight:700}.mf-row-copy small{font-size:8px;color:#9ba3aa;margin-top:3px}.mf-status{background:#eaf3ee;color:#548269;border-radius:3px;padding:4px 6px;font-size:7px;font-weight:700;white-space:nowrap}.status-draft{background:#f7f0e7;color:#9b7c4b}.mf-float-note{position:absolute;z-index:3;right:-5px;bottom:9px;display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e4e8e7;padding:10px 13px;border-radius:5px;box-shadow:0 10px 25px rgba(31,50,71,.12);font-size:9px;color:var(--navy)}.mf-note-icon{width:25px;height:25px;display:grid;place-items:center;background:#edf3ef;color:#55816e;border-radius:50%}.mf-float-note b,.mf-float-note small{display:block}.mf-float-note small{margin-top:3px;color:#88939b;font-size:8px}.mf-float-note>svg{color:#68927b;margin-left:4px}.mf-orbit{position:absolute;border:1px solid #bdccd0;border-radius:50%;z-index:-1}.orbit-one{width:34px;height:34px;right:16%;top:0}.orbit-two{width:10px;height:10px;right:9%;top:38%;background:var(--red);border:0}.mf-hero-bottom{height:54px;border-top:1px solid #e1e5e3;width:min(1220px,calc(100% - 64px));margin:0 auto;display:flex;align-items:center;justify-content:space-between;color:#89949d;font:9px 'DM Mono',monospace;letter-spacing:.1em}.mf-hero-bottom a{display:flex;align-items:center;gap:8px;color:#536d84;font:600 10px 'Plus Jakarta Sans',sans-serif;letter-spacing:0}.mf-intro{display:grid;grid-template-columns:1fr 1.25fr .85fr;gap:40px;align-items:start;padding-top:122px;padding-bottom:125px}.mf-intro-aside{display:flex;flex-direction:column;gap:74px}.mf-index{font:9px 'DM Mono',monospace;letter-spacing:.09em;color:#a0a8ad}.mf-intro-copy h2,.mf-section-heading h2,.principles-intro h2,.mf-plan-heading h2,.faq-layout h2{font-size:clamp(38px,4.4vw,56px);letter-spacing:-.065em;line-height:1.08;color:var(--navy);margin:0;font-weight:700}.mf-intro-copy h2 span{color:#83939b}.mf-intro-copy p{color:var(--body);font-size:14px;line-height:1.9;max-width:430px;margin:23px 0 21px}.mf-underlined-link{padding-bottom:8px;border-bottom:1px solid #9aaab0}.mf-route-graphic{align-self:center;padding-top:75px}.route-label{font:8px 'DM Mono',monospace;letter-spacing:.1em;color:#9ba6aa}.route-line{display:flex;align-items:center;justify-content:space-between;margin:22px 0 11px;position:relative}.route-line:before{content:"";position:absolute;left:0;right:26px;border-top:1px dashed #a9bbc0}.route-line i{position:relative;display:block;width:8px;height:8px;background:#f6f7f4;border:1px solid #7193a0;border-radius:50%}.route-line span{position:relative;display:grid;place-items:center;width:29px;height:29px;border-radius:50%;background:#e8eeef;color:var(--blue)}.route-steps{display:flex;justify-content:space-between;color:#788792;font-size:8px;gap:7px}.mf-feature-section{padding:104px 0 122px;background:#eaf0f0}.mf-section-heading{display:flex;justify-content:space-between;align-items:end;margin-bottom:42px}.mf-section-heading h2{margin-top:19px}.mf-section-heading>p{max-width:310px;font-size:13px;color:#6d7c85;line-height:1.8;margin:0 2% 4px 0}.mf-feature-grid{display:grid;grid-template-columns:1.15fr 1fr 1fr;gap:14px;align-items:stretch}.mf-feature{min-height:485px;position:relative;padding:29px 25px 22px;border:1px solid #d7e1e2;border-radius:5px;background:#f8f9f6;overflow:hidden}.mf-feature-wide{grid-column:span 1}.mf-feature-number{position:absolute;right:23px;top:27px;color:#abb8ba;font:9px 'DM Mono',monospace}.mf-feature-icon{width:40px;height:40px;display:grid;place-items:center;border-radius:50%;background:#e4edf0;color:#356990}.mf-feature-icon.icon-coral{background:#f5e9e4;color:#b36c5d}.mf-feature-icon.icon-cream{background:#f1eee4;color:#927d4a}.mf-feature h3{max-width:275px;margin:24px 0 12px;color:var(--navy);font-size:21px;line-height:1.27;letter-spacing:-.05em}.mf-feature p{margin:0;color:#6e7d85;font-size:11px;line-height:1.8}.mf-contact-preview{border:1px solid #e0e7e6;border-radius:4px;background:#fff;margin-top:28px;padding:0 12px}.mf-preview-head{display:flex;justify-content:space-between;border-bottom:1px solid #edf0ef;padding:11px 0;color:#9ca6a7;font:7px 'DM Mono',monospace;letter-spacing:.07em}.mf-contact-line{display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid #f0f2f1}.mf-contact-line:last-child{border:0}.mf-initials{width:24px;height:24px;border-radius:50%;background:#e6edf2;color:#526d83;display:grid;place-items:center;font-size:7px;font-weight:700}.mf-initials.warm{background:#f3e8e2;color:#a36553}.mf-initials.lilac{background:#ebe9ef;color:#756987}.mf-contact-line>span:nth-child(2){flex:1;min-width:0}.mf-contact-line b,.mf-contact-line small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mf-contact-line b{font-size:8px;color:#415163}.mf-contact-line small{font-size:7px;color:#9ba5a7;margin-top:2px}.mf-tag{font:7px 'DM Mono',monospace;color:#678674;background:#edf3ef;border-radius:8px;padding:4px 6px}.tag-warm{color:#9d7750;background:#f5efe4}.mf-composer{margin-top:29px;border:1px solid #e1e6e5;border-radius:4px;background:#fff;overflow:hidden}.composer-top{display:flex;align-items:center;gap:4px;height:28px;padding:0 9px;background:#f7f8f6;border-bottom:1px solid #e8eceb}.composer-dot{width:4px;height:4px;background:#d2d9d8;border-radius:50%}.composer-top span:last-child{margin-left:5px;color:#a2acab;font:6px 'DM Mono',monospace;letter-spacing:.08em}.composer-field{padding:9px;border-bottom:1px solid #eff1f0;color:#a0a8a8;font:7px 'DM Mono',monospace}.composer-field b{color:#566574;font:600 7px 'Plus Jakarta Sans',sans-serif;margin-left:7px}.composer-field b span{font-weight:400;color:#8f9b9e;margin-left:5px}.composer-body{padding:12px 9px 3px}.composer-body i{display:block;height:3px;width:92%;background:#e9eeec;margin:0 0 6px;border-radius:3px}.composer-body i:nth-child(2){width:75%}.composer-body i:nth-child(3){width:49%}.composer-action{margin:9px;display:flex;justify-content:space-between;align-items:center;padding:7px 8px;background:var(--blue);color:#fff;font-size:7px;border-radius:3px}.mf-outcome{margin-top:30px;padding:13px;border:1px solid #e0e6e5;border-radius:4px;background:#fff}.outcome-title{display:flex;align-items:center;justify-content:space-between;color:#829091;font:7px 'DM Mono',monospace;letter-spacing:.06em}.outcome-stats{display:grid;grid-template-columns:repeat(3,1fr);padding:14px 0 12px;border-bottom:1px solid #edf0ef}.outcome-stats b,.outcome-stats small{display:block}.outcome-stats b{font-size:18px;color:#3d5361;letter-spacing:-.06em}.outcome-stats small{font-size:7px;color:#929d9e;margin-top:4px}.outcome-foot{display:flex;justify-content:space-between;align-items:center;padding-top:9px;color:#879395;font-size:6.5px}.outcome-foot span:first-child{display:flex;align-items:center;gap:4px;color:#62816e}.mf-principles{padding:112px 0;background:#f6f7f4}.principles-layout{display:grid;grid-template-columns:.9fr 1.1fr;gap:11%;align-items:start}.principles-intro h2{font-size:clamp(38px,4vw,51px);margin-top:20px}.principles-intro p{margin-top:21px;max-width:380px;color:var(--body);font-size:13px;line-height:1.9}.principle-list{border-top:1px solid #dce2e2}.principle-list article{display:grid;grid-template-columns:32px 1fr 20px;gap:17px;align-items:start;padding:22px 0 21px;border-bottom:1px solid #dce2e2}.principle-index{font:10px 'DM Mono',monospace;color:var(--red);padding-top:3px}.principle-list h3{font-size:14px;letter-spacing:-.02em;color:var(--navy);margin:0}.principle-list p{font-size:11px;line-height:1.75;color:#78868c;margin:7px 0 0;max-width:410px}.principle-list article>svg{color:#79909a}.mf-final-cta{min-height:450px;position:relative;overflow:hidden;display:flex;align-items:center;background:#17263e;color:#fff;padding:80px max(calc((100% - 1150px)/2),32px)}.mf-final-inner{position:relative;z-index:2}.mf-final-cta .mf-eyebrow{color:#a8bdca}.mf-final-cta .mf-eyebrow>span{background:#ed6b6d}.mf-final-cta h2{font-size:clamp(45px,5.3vw,67px);letter-spacing:-.07em;line-height:1.02;margin:22px 0 15px;color:#f5f6f3}.mf-final-cta p{font-size:13px;line-height:1.8;color:#adbac5;max-width:410px;margin:0 0 25px}.mf-button-light{background:#f3f5f1;border-color:#f3f5f1;color:var(--navy)!important}.mf-button-light:hover{background:#e2e9e9;border-color:#e2e9e9}.cta-note{display:block;margin-top:16px;color:#899aa8;font:8px 'DM Mono',monospace;letter-spacing:.04em}.cta-route{position:absolute;right:4%;top:50%;transform:translateY(-50%);height:340px;width:44%;border:1px solid rgba(168,190,201,.18);border-radius:50%}.cta-route:before,.cta-route:after{content:"";position:absolute;inset:28px;border:1px solid rgba(168,190,201,.14);border-radius:50%}.cta-route:after{inset:60px}.cta-route span{position:absolute;width:10px;height:10px;background:#243d5c;border:1px solid #7391a3;border-radius:50%;left:18%;top:50%}.cta-route span:nth-child(2){left:70%;top:13%;background:var(--red);border-color:var(--red)}.cta-route span:nth-child(3){left:82%;top:72%}.cta-side-note{position:absolute;right:8%;bottom:37px;color:#7b8e9d;font:8px 'DM Mono',monospace;letter-spacing:.1em;line-height:2}.cta-side-note span{color:#aebbc4}.mf-footer{background:#f0f2ef;padding:37px max(calc((100% - 1150px)/2),32px) 17px}.mf-footer-main{display:flex;justify-content:space-between;padding-bottom:32px}.mf-footer-main p{font-size:10px;color:#7c888d;margin:12px 0 0}.mf-footer-links{display:flex;gap:85px}.mf-footer-links>div{display:flex;flex-direction:column;gap:9px;font-size:10px;color:#697981}.mf-footer-label{font:8px 'DM Mono',monospace;letter-spacing:.1em;color:#a0a8a7;text-transform:uppercase;margin-bottom:2px}.mf-footer-links a:hover{color:var(--blue)}.mf-footer-bottom{border-top:1px solid #dce2df;padding-top:14px;display:flex;justify-content:space-between;align-items:center;color:#919b9a;font:8px 'DM Mono',monospace;letter-spacing:.03em}.mf-footer-bottom a{display:flex;align-items:center;gap:6px;color:#607786}.mf-pricing-main{background:#f6f7f4}.mf-pricing-hero{position:relative;min-height:410px;padding:66px max(calc((100% - 1150px)/2),32px) 51px;background:#f6f7f4;overflow:hidden}.pricing-hero-kicker{display:flex;justify-content:space-between;align-items:center}.pricing-hero-kicker>span{font:9px 'DM Mono',monospace;color:#9aa4a4;letter-spacing:.11em}.mf-pricing-hero h1{font-size:clamp(55px,7vw,84px);margin:24px 0 14px;position:relative;z-index:1}.mf-pricing-hero h1 em:after{content:none}.mf-pricing-hero>p{position:relative;z-index:1;color:var(--body);font-size:13px;line-height:1.8;max-width:500px;margin:0}.mf-pricing-scroll{position:relative;z-index:1;margin-top:23px;display:inline-flex;align-items:center;gap:8px;font-size:11px;color:var(--blue);font-weight:700}.mf-price-decoration{position:absolute;width:390px;height:390px;border:1px solid #e0e7e5;border-radius:50%;right:8%;top:64px;display:flex;justify-content:center;align-items:center;color:#a2b0b1}.mf-price-decoration:before,.mf-price-decoration:after{content:"";position:absolute;inset:22px;border:1px solid #e6ebe9;border-radius:50%}.mf-price-decoration:after{inset:57px}.mf-price-decoration>span{position:absolute;top:18%;font:9px 'DM Mono',monospace;letter-spacing:.12em}.mf-price-decoration>i{position:absolute;left:15%;top:50%;width:6px;height:6px;border-radius:50%;background:#7895a2}.mf-price-decoration>i:nth-of-type(2){left:70%;top:23%;background:var(--red)}.mf-price-decoration>i:nth-of-type(3){left:79%;top:72%}.mf-price-decoration>b{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#e9eeee;color:var(--blue)}.mf-plan-section{padding:67px 0 76px;background:#eaf0f0}.mf-plan-heading{display:flex;justify-content:space-between;align-items:end;margin-bottom:29px}.mf-plan-heading h2{font-size:38px;margin-top:17px}.mf-plan-heading>p{max-width:300px;font-size:11px;line-height:1.8;color:#76848a;margin:0 2% 4px 0}.mf-plan-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px;align-items:stretch}.mf-plan-card{position:relative;display:flex;flex-direction:column;min-height:407px;padding:24px 23px 18px;border:1px solid #d6dfdf;border-radius:5px;background:#f8f9f6;transition:transform .2s ease,box-shadow .2s ease}.mf-plan-card:hover{transform:translateY(-4px);box-shadow:0 15px 32px rgba(32,55,69,.09)}.mf-plan-card.plan-featured{border-color:#587da2;background:#f6f8f6;box-shadow:inset 0 3px var(--blue)}.plan-card-top{display:flex;align-items:center;justify-content:space-between;gap:6px}.plan-overline,.plan-featured-tag{font:8px 'DM Mono',monospace;letter-spacing:.07em;color:#879799}.plan-featured-tag{color:#3b6690}.mf-plan-card h2{font-size:24px;letter-spacing:-.05em;color:var(--navy);margin:20px 0 5px}.plan-description{height:36px;margin:0;color:#74838a;font-size:10px;line-height:1.7;overflow:hidden}.plan-price{display:flex;align-items:baseline;gap:8px;margin:18px 0 17px}.plan-price strong{color:var(--navy);font-size:32px;letter-spacing:-.065em;line-height:1}.plan-price span{font-size:9px;color:#7c8b8e}.plan-rule{border-top:1px solid #dfe6e4}.plan-includes{margin:18px 0 9px;color:#9aa5a4;font:8px 'DM Mono',monospace;letter-spacing:.1em}.plan-limits{list-style:none;margin:0;padding:0;display:grid;gap:10px}.plan-limits li{display:flex;align-items:center;gap:9px;color:#687980;font-size:10px}.plan-limits b{color:#34495a}.limit-icon{display:grid;place-items:center;width:23px;height:23px;border-radius:50%;background:#eaf0ee;color:#5a8194}.plan-button{width:100%;margin-top:auto;min-height:43px;font-size:11px}.button-outline{background:transparent;border-color:#bcc9cb;color:#365c78!important}.button-outline:hover{background:#e8eff1;border-color:#6d94a3;color:#234f7a!important}.button-navy{background:var(--navy);border-color:var(--navy)}.button-navy:hover{background:#223b5c;border-color:#223b5c}.plan-footnote{margin:10px 0 0;text-align:center;color:#96a0a0;font-size:8px}.mf-pricing-note{display:flex;align-items:flex-start;gap:11px;margin-top:23px;padding:15px 18px;border:1px solid #d8e1df;background:rgba(248,249,246,.65);color:#66806f}.mf-pricing-note p{margin:0;color:#75847f;font-size:10px;line-height:1.8}.mf-pricing-state{display:flex;align-items:center;gap:16px;padding:25px;border:1px solid #d7e1df;border-radius:5px;background:#f8f9f6}.state-icon{width:39px;height:39px;flex:none;display:grid;place-items:center;border-radius:50%;background:#e7eeed;color:#5e7d8a}.mf-pricing-state h3{margin:0 0 5px;color:var(--navy);font-size:14px;letter-spacing:-.03em}.mf-pricing-state p{margin:0;color:#738188;font-size:11px;line-height:1.7}.mf-pricing-state .mf-button{margin-left:auto;flex:none;min-height:40px;font-size:10px}.mf-plans-skeleton{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}.mf-plans-skeleton>div{height:405px;border:1px solid #dae2e0;border-radius:5px;background:linear-gradient(110deg,#f4f6f3 8%,#e9efed 18%,#f4f6f3 33%);background-size:200% 100%;animation:mf-shimmer 1.35s ease-in-out infinite}@keyframes mf-shimmer{to{background-position-x:-200%}}.mf-pricing-bottom{padding:75px max(calc((100% - 1150px)/2),32px);display:flex;align-items:center;justify-content:space-between;background:#f6f7f4}.mf-small-label{font:8px 'DM Mono',monospace;letter-spacing:.11em;color:#8b999c}.mf-pricing-bottom h2{font-size:38px;line-height:1.1;letter-spacing:-.06em;color:var(--navy);margin:16px 0 10px}.mf-pricing-bottom p{margin:0;color:#728088;font-size:11px}.mf-pricing-faq{padding:90px 0 108px;background:#eaf0f0}.faq-layout{display:grid;grid-template-columns:.7fr 1.3fr;gap:12%}.faq-layout h2{font-size:39px;margin-top:19px}.faq-items{border-top:1px solid #d3dddc}.faq-items details{border-bottom:1px solid #d3dddc;padding:0 3px}.faq-items summary{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:18px 0;list-style:none;color:#263c4d;font-size:12px;font-weight:700;cursor:pointer}.faq-items summary::-webkit-details-marker{display:none}.faq-items summary svg{color:#78909a;transition:transform .2s}.faq-items details[open] summary svg{transform:rotate(180deg)}.faq-items details p{font-size:11px;color:#75848a;line-height:1.8;max-width:600px;margin:-4px 25px 18px 0}
    @media(max-width:900px){.mf-nav-wrap,.mf-hero-grid,.mf-hero-bottom{width:calc(100% - 44px)}.mf-hero{padding-top:64px}.mf-hero-grid{grid-template-columns:1fr 1fr;gap:0}.mf-hero h1{font-size:clamp(50px,7vw,68px)}.mf-hero-visual{min-height:385px;padding-left:14px}.mf-dashboard{min-height:305px}.mf-dash-main{padding:16px 13px}.mf-dash-summary>div{padding:8px 7px}.mf-dash-summary strong{font-size:18px}.mf-feature-grid{grid-template-columns:repeat(2,1fr)}.mf-feature{min-height:465px}.mf-feature:first-child{grid-column:span 2;min-height:400px}.mf-feature:first-child .mf-contact-preview{max-width:420px}.mf-intro{grid-template-columns:.65fr 1.15fr;gap:28px}.mf-route-graphic{grid-column:2;padding-top:5px}.mf-plan-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.mf-plan-card:last-child:nth-child(odd){grid-column:1/-1;min-height:350px}.mf-price-decoration{right:-6%;opacity:.65}.mf-pricing-hero{min-height:390px}}
    @media(max-width:640px){.mf-site{overflow:hidden}.mf-header{height:68px}.mf-nav-wrap{width:calc(100% - 34px)}.mf-menu-toggle{display:grid;place-items:center;width:38px;height:38px;border:1px solid #dce3e1;background:#f7f8f5;border-radius:4px;color:var(--navy)}.mf-menu-toggle svg{width:19px;height:19px}.mf-nav{display:none;position:absolute;top:67px;left:0;right:0;height:auto;padding:13px 18px 20px;background:#f6f7f4;border-bottom:1px solid #dce4e1;box-shadow:0 10px 17px rgba(30,48,62,.07);align-items:stretch;gap:0}.mf-nav.is-open{display:flex;flex-direction:column}.mf-nav>a{padding:13px 7px}.mf-nav-spacer{display:none}.mf-nav .mf-login{margin:0}.mf-nav .mf-button{margin-top:6px}.mf-hero{padding:48px 0 0;min-height:auto}.mf-hero-grid{width:calc(100% - 38px);display:flex;flex-direction:column;align-items:stretch}.mf-hero-copy{padding:4px 0 0}.mf-hero h1{font-size:clamp(50px,14vw,71px);margin:21px 0 16px}.mf-hero-lede{font-size:13px;line-height:1.8}.mf-hero-actions{gap:19px;margin-top:23px}.mf-hero-actions .mf-button{min-height:47px;padding:0 15px;font-size:11px}.mf-hero-footnote{font-size:8px;margin-top:18px;flex-wrap:wrap}.mf-hero-visual{margin:25px -3px 3px;padding:23px 5px 24px 15px;min-height:310px}.mf-hero-visual:before{inset:0 4px 4px 0}.mf-dashboard{min-height:260px}.mf-dash-main{padding:14px 11px}.mf-dash-heading h3{font-size:15px}.mf-dash-summary{margin:12px 0 10px}.mf-dash-summary>div{padding:8px 5px}.mf-dash-summary span{font-size:7px}.mf-dash-summary strong{font-size:17px}.mf-dash-summary small{font-size:6px}.mf-campaign-card{padding:9px 8px 0}.mf-campaign-row{height:45px;gap:6px}.mf-row-copy b{font-size:7px}.mf-row-copy small{font-size:6px}.mf-status{font-size:6px;padding:3px 4px}.mf-row-icon{width:22px;height:22px}.mf-float-note{right:0;bottom:0;padding:8px 10px}.mf-hero-bottom{width:calc(100% - 38px);height:48px;font-size:7px}.mf-hero-bottom a{font-size:8px}.mf-section-wrap{width:calc(100% - 38px)}.mf-intro{padding-top:70px;padding-bottom:72px;grid-template-columns:1fr;gap:22px}.mf-intro-aside{gap:14px}.mf-index{font-size:8px}.mf-intro-copy h2,.mf-section-heading h2,.principles-intro h2{font-size:42px}.mf-intro-copy p{font-size:12px;margin:16px 0}.mf-route-graphic{grid-column:auto;padding:11px 0 0}.mf-feature-section{padding:69px 0 75px}.mf-section-heading{display:block;margin-bottom:26px}.mf-section-heading h2{margin-top:17px}.mf-section-heading>p{margin-top:14px;font-size:11px}.mf-feature-grid{grid-template-columns:1fr;gap:11px}.mf-feature,.mf-feature:first-child{grid-column:auto;min-height:auto;padding:24px 20px 20px}.mf-feature h3{font-size:20px}.mf-feature p{font-size:10px}.mf-contact-preview,.mf-composer,.mf-outcome{margin-top:22px}.mf-principles{padding:72px 0}.principles-layout{grid-template-columns:1fr;gap:29px}.principles-intro h2{font-size:40px}.principles-intro p{font-size:11px}.principle-list article{gap:11px;padding:17px 0}.principle-list h3{font-size:12px}.principle-list p{font-size:10px}.mf-final-cta{min-height:410px;padding:63px 20px}.mf-final-cta h2{font-size:48px}.mf-final-cta p{font-size:11px;max-width:300px}.cta-route{width:90%;height:290px;right:-42%;opacity:.7}.cta-side-note{right:6%;bottom:18px;font-size:7px}.mf-footer{padding:29px 19px 14px}.mf-footer-main{gap:25px;flex-direction:column;padding-bottom:23px}.mf-footer-links{gap:50px}.mf-footer-bottom{font-size:7px}.mf-footer-bottom span:nth-child(2){display:none}.mf-pricing-hero{min-height:355px;padding:49px 19px 38px}.pricing-hero-kicker>span{font-size:7px}.mf-pricing-hero h1{font-size:55px;margin:22px 0 12px}.mf-pricing-hero>p{font-size:11px;max-width:315px}.mf-price-decoration{width:210px;height:210px;right:-100px;top:135px;opacity:.5}.mf-price-decoration>span{font-size:6px}.mf-plan-section{padding:55px 0 57px}.mf-plan-heading{display:block;margin-bottom:22px}.mf-plan-heading h2{font-size:32px}.mf-plan-heading>p{margin-top:12px;font-size:10px}.mf-plan-grid{grid-template-columns:1fr;gap:11px}.mf-plan-card,.mf-plan-card:last-child:nth-child(odd){grid-column:auto;min-height:380px;padding:22px 20px 17px}.mf-plan-card h2{font-size:23px}.mf-plan-card:hover{transform:none}.mf-pricing-state{align-items:flex-start;flex-wrap:wrap;padding:18px}.mf-pricing-state>div{width:calc(100% - 58px)}.mf-pricing-state .mf-button{margin:0 0 0 55px}.mf-pricing-state p{font-size:10px}.mf-pricing-note{padding:12px;gap:8px}.mf-pricing-note p{font-size:9px}.mf-pricing-bottom{padding:54px 19px;display:block}.mf-pricing-bottom h2{font-size:35px}.mf-pricing-bottom p{font-size:10px;max-width:275px;line-height:1.8}.mf-pricing-bottom>.mf-button{margin-top:20px}.mf-pricing-faq{padding:65px 0 75px}.faq-layout{grid-template-columns:1fr;gap:26px}.faq-layout h2{font-size:36px}.faq-items summary{font-size:11px}.faq-items details p{font-size:10px}}
    .mf-dash-summary strong{font-size:11px;letter-spacing:-.02em;white-space:nowrap}
    @media(max-width:640px){.mf-dash-summary strong{font-size:8px;letter-spacing:-.03em}}
     .mf-features-page{--ft-paper:#f6f7f4;--ft-ink:#142035;--ft-blue:#2865ae;--ft-muted:#6e7e88;--ft-line:#dbe3e2;background:var(--ft-paper)}
     .mf-features-page .mf-eyebrow{color:#496d8e}
     .ft-hero{padding-top:73px;background:#f6f7f4}
     .ft-hero-wrap{width:min(1220px,calc(100% - 64px));margin:auto;display:grid;grid-template-columns:.92fr 1.08fr;gap:45px;align-items:center}
     .ft-hero-copy{padding:13px 0 44px;animation:ft-rise .65s cubic-bezier(.2,.75,.25,1) both}
     .ft-hero-index{margin:37px 0 0;color:#9aa6a9;font:9px 'DM Mono',monospace;letter-spacing:.12em}
     .ft-hero h1{margin:17px 0 20px;color:var(--navy);font-size:clamp(49px,6vw,78px);font-weight:700;letter-spacing:-.075em;line-height:1.02}
     .ft-hero h1 em,.ft-section-copy h2 em,.ft-campaign-intro h2 em,.ft-sender-heading h2 em,.ft-history-layout h2 em,.ft-final-inner h2 em{font-style:normal;color:#3977ae}
     .ft-hero-lede{max-width:500px;margin:0;color:#687988;font-size:14px;line-height:1.9}
     .ft-hero-copy .mf-hero-actions{margin-top:27px}
     .ft-hero-note{display:flex;align-items:center;gap:8px;margin-top:23px;color:#70838b;font-size:10px}
     .ft-hero-note svg{color:#54836d}
     .ft-hero-art{position:relative;min-height:460px;padding:25px 23px 23px 30px;isolation:isolate;animation:ft-rise .72s .1s cubic-bezier(.2,.75,.25,1) both}
     .ft-hero-art:before{content:"";position:absolute;z-index:-1;inset:3px 0 10px 17px;background:#e8efef;border-radius:46% 4px 4px 4px}
     .ft-hero-art:after{content:"";position:absolute;z-index:-1;right:-17px;top:40px;width:112px;height:112px;border:1px solid #d2dedf;border-radius:50%}
     .ft-art-label,.ft-art-caption{display:flex;justify-content:space-between;align-items:center;color:#8b9a9d;font:8px 'DM Mono',monospace;letter-spacing:.09em}
     .ft-art-label{padding:1px 4px 0 1px}
     .ft-route-stage{position:relative;margin:28px 0 0 7px;padding:22px 22px 18px;background:#f9faf7;border:1px solid #dbe4e3;border-radius:5px;box-shadow:0 19px 36px rgba(34,57,72,.09);transform:rotate(-1deg)}
     .ft-route-card{min-height:69px;display:flex;align-items:center;gap:12px;padding:11px 13px;background:white;border:1px solid #e5eae8;border-radius:4px}
     .ft-route-card>span:nth-child(2){display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
     .ft-route-icon{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#e8eff3;color:#42749a;flex:none}
     .ft-route-card small{color:#9ba7a9;font:7px 'DM Mono',monospace;letter-spacing:.1em}
     .ft-route-card b{font-size:10px;color:#263b4b}
     .ft-route-card em{font-style:normal;color:#8e9b9d;font-size:8px}
     .ft-route-card>svg{color:#639174}
     .ft-route-campaign .ft-route-icon{background:#f5eae3;color:#b27462}
     .ft-route-smtp .ft-route-icon{background:#eaf1eb;color:#55816b}
     .ft-connected{font:7px 'DM Mono',monospace;color:#54816a;letter-spacing:.04em}
     .ft-route-connector{height:26px;display:flex;flex-direction:column;align-items:center;justify-content:space-evenly}
     .ft-route-connector i{display:block;width:3px;height:3px;border-radius:50%;background:#9db1b3}
     .ft-hero-callout{display:flex;align-items:center;gap:10px;margin:17px 0 0 22px;color:#6c7d83;font-size:8px;line-height:1.8}
     .ft-hero-callout b{color:#395361}
     .ft-callout-line{width:21px;height:1px;background:#d46c66}
     .ft-art-caption{margin:19px 3px 0 7px;font-size:7px;color:#a1adae}
     .ft-hero-bottom{width:min(1220px,calc(100% - 64px));height:53px;margin:auto;border-top:1px solid #e1e6e4;display:flex;align-items:center;justify-content:space-between;color:#929e9f;font:8px 'DM Mono',monospace;letter-spacing:.1em}
     .ft-hero-bottom a{display:flex;align-items:center;gap:7px;color:#52718a;font:600 10px 'Plus Jakarta Sans',sans-serif;letter-spacing:0}
     .ft-thesis{padding:32px 0;background:#eaf0f0;border-top:1px solid #e3e9e7;border-bottom:1px solid #dde5e3}
     .ft-thesis-inner{display:grid;grid-template-columns:170px 1fr 135px;align-items:center;gap:30px}
     .ft-thesis-kicker,.ft-thesis-end{font:8px 'DM Mono',monospace;letter-spacing:.1em;color:#839296;line-height:1.8}
     .ft-thesis-inner p{max-width:760px;margin:0;color:#20364a;font-size:clamp(17px,2vw,24px);font-weight:600;letter-spacing:-.04em;line-height:1.45}
     .ft-thesis-inner p em{font-style:normal;color:#557e99}
     .ft-thesis-end{text-align:right}
     .ft-audience-section{padding:111px 0 116px;background:#f6f7f4}
     .ft-audience-layout{display:grid;grid-template-columns:.84fr 1.16fr;gap:8%;align-items:center}
     .ft-section-copy h2,.ft-campaign-intro h2,.ft-sender-heading h2,.ft-history-layout h2{margin:20px 0 17px;color:var(--navy);font-size:clamp(39px,4.5vw,56px);font-weight:700;letter-spacing:-.07em;line-height:1.06}
     .ft-section-copy>p,.ft-sender-heading>p,.ft-history-layout>div:first-child>p{max-width:420px;margin:0;color:#6e7e88;font-size:12px;line-height:1.9}
     .ft-check-list{list-style:none;display:grid;gap:12px;margin:24px 0 22px;padding:0;color:#536d78;font-size:10px}
     .ft-check-list li{display:flex;align-items:center;gap:9px}
     .ft-check-list svg{color:#5d8a72;flex:none}
     .ft-audience-foot{display:flex;gap:6px;flex-wrap:wrap}
     .ft-field-chip{padding:6px 8px;border:1px solid #d9e2df;border-radius:2px;color:#81918f;font:7px 'DM Mono',monospace;letter-spacing:.06em}
     .ft-preview-stage{position:relative;padding:24px 0 14px 19px}
     .ft-preview-stage:before{content:"";position:absolute;inset:0 0 28px 0;background:#edf1ef;border-radius:44% 3px 3px 3px}
     .ft-preview-label{position:relative;display:flex;justify-content:space-between;padding:0 14px 10px;color:#8b9a9d;font:7px 'DM Mono',monospace;letter-spacing:.1em}
     .ft-audience-window{position:relative;padding:12px 13px 0;background:#fff;border:1px solid #dfe6e5;border-radius:5px;box-shadow:0 17px 32px rgba(35,57,73,.1);transform:rotate(.7deg)}
     .ft-window-bar{display:flex;align-items:center;gap:10px;height:24px;border-bottom:1px solid #edf0ef;color:#8a9899;font:7px 'DM Mono',monospace;letter-spacing:.07em}
     .ft-window-dots{display:flex;gap:3px}.ft-window-dots i{width:4px;height:4px;border-radius:50%;background:#d6dedd}
     .ft-window-count{display:flex;align-items:center;gap:5px;margin-left:auto;color:#64849a}
     .ft-search{height:30px;margin:11px 0 10px;display:flex;align-items:center;gap:7px;padding:0 9px;border:1px solid #e9edeb;border-radius:3px;color:#a1acad;font-size:7px}
     .ft-search svg{color:#78929c}.ft-search span{margin-left:auto;font:7px 'DM Mono',monospace}
     .ft-table-head,.ft-person-row{display:grid;grid-template-columns:1.42fr 1fr .69fr;align-items:center;gap:8px}
     .ft-table-head{padding:0 6px 7px;color:#a0acab;font:6px 'DM Mono',monospace;letter-spacing:.08em}
     .ft-person-row{min-height:48px;border-top:1px solid #f0f2f1;color:#74858b;font-size:7px}
     .ft-avatar{grid-column:1;grid-row:1;display:grid;place-items:center;width:23px;height:23px;border-radius:50%;background:#e7edf1;color:#526f83;font-size:7px;font-weight:700}
     .ft-person-row>span:nth-child(2){grid-column:1;grid-row:1;padding-left:31px;min-width:0}
     .ft-person-row>span:nth-child(2) b,.ft-person-row>span:nth-child(2) small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
     .ft-person-row>span:nth-child(2) b{color:#364b59;font-size:7px}.ft-person-row>span:nth-child(2) small{margin-top:3px;color:#9aa5a5;font-size:6px}
     .ft-person-row>span:nth-child(3){grid-column:2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
     .ft-person-row em{justify-self:start;padding:4px 6px;border-radius:8px;background:#edf3ef;color:#668373;font:6px 'DM Mono',monospace;font-style:normal;white-space:nowrap}
     .ft-person-row em.ft-prospect{background:#f7f0e6;color:#96764e}
     .ft-avatar-peach{background:#f4e9e2;color:#a56a55}.ft-avatar-sage{background:#e9efe8;color:#5d7f69}
     .ft-window-footer{height:33px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid #edf0ef;color:#9aa6a6;font-size:7px}
     .ft-window-footer span:last-child{display:flex;align-items:center;gap:4px;color:#557d97}
     .ft-history-note{position:relative;display:flex;align-items:center;gap:9px;width:78%;margin:-1px 0 0 auto;padding:10px 12px;border:1px solid #e2e8e5;border-radius:3px;background:#fff;box-shadow:0 8px 20px rgba(35,57,73,.07);color:#81918f}
     .ft-history-pin{width:24px;height:24px;display:grid;place-items:center;border-radius:50%;background:#edf2ed;color:#5f876c}
     .ft-history-note>span:nth-child(2){flex:1}
     .ft-history-note b,.ft-history-note small{display:block}.ft-history-note b{font-size:8px;color:#536b69}.ft-history-note small{margin-top:3px;font-size:7px;line-height:1.5}.ft-history-note>svg{color:#8fa19e}
     .ft-campaign-section{padding:100px 0 38px;background:#eaf0f0}
     .ft-campaign-intro{display:flex;justify-content:space-between;align-items:end;gap:30px;margin-bottom:40px}
     .ft-campaign-intro h2{margin-bottom:0}.ft-campaign-intro>p{max-width:330px;margin:0 3% 4px 0;color:#718188;font-size:11px;line-height:1.9}
     .ft-campaign-layout{display:grid;grid-template-columns:1fr .86fr;gap:9%;align-items:center}
     .ft-campaign-window{padding:20px 21px 15px;background:#fafbf8;border:1px solid #d7e1df;border-radius:5px;box-shadow:0 16px 34px rgba(33,57,72,.08);transform:rotate(-.8deg)}
     .ft-campaign-window-head{display:flex;align-items:center;justify-content:space-between;padding-bottom:15px;border-bottom:1px solid #e8eeeb;color:#394e5c;font-size:9px;font-weight:700}
     .ft-campaign-window-head>span:first-child{display:flex;align-items:center;gap:8px}
     .ft-campaign-mark{width:25px;height:25px;display:grid;place-items:center;border-radius:5px;background:#e8eff2;color:#3f7194}
     .ft-draft-badge{padding:4px 6px;border-radius:2px;background:#f6efe5;color:#9c7c4e;font:7px 'DM Mono',monospace}
     .ft-campaign-field{padding:14px 0;border-bottom:1px solid #ebefed}
     .ft-campaign-field>small{display:flex;justify-content:space-between;color:#96a3a2;font:7px 'DM Mono',monospace;letter-spacing:.09em}
     .ft-campaign-field>b{display:block;margin-top:7px;color:#344958;font-size:9px}
     .ft-campaign-field>span{display:block;margin-top:5px;color:#a2acab;font-size:7px}
     .ft-audience-field>small span{color:#57809a}
     .ft-audience-field>div{display:flex;align-items:center;gap:7px;margin-top:9px;color:#506573;font-size:8px}
     .ft-audience-field>div b{flex:1}
     .ft-audience-field>div>span:last-child{color:#899a9b;font:7px 'DM Mono',monospace}
     .ft-list-check{width:14px;height:14px;display:grid;place-items:center;border-radius:3px;background:#e7f0e9;color:#528065}
     .ft-audience-count{display:flex;flex-direction:column;padding:13px 0 11px;color:#859391;font-size:7px}
     .ft-audience-count b{margin-top:5px;color:#415b68;font-size:9px}
     .ft-audience-count small{margin-top:4px;color:#96a2a1;font-size:7px;line-height:1.5}
     .ft-preview-actions{display:flex;justify-content:space-between;gap:9px;padding-top:13px;border-top:1px solid #e8eeeb}
     .ft-preview-actions span{display:flex;align-items:center;gap:5px;font-size:7px;color:#527995}
     .ft-preview-actions span:last-child{padding:8px 9px;border-radius:3px;background:#2865ae;color:white}
     .ft-campaign-steps{display:grid;gap:0}
     .ft-campaign-steps article{display:grid;grid-template-columns:28px 1fr;gap:13px;padding:15px 0;border-bottom:1px solid #d5e0de}
     .ft-campaign-steps article:first-child{border-top:1px solid #d5e0de}
     .ft-campaign-steps article>span{padding-top:2px;color:#c46c62;font:9px 'DM Mono',monospace}
     .ft-campaign-steps h3{margin:0;color:#273d4b;font-size:12px;letter-spacing:-.03em}
     .ft-campaign-steps p{max-width:330px;margin:6px 0 0;color:#74848a;font-size:9px;line-height:1.75}
     .ft-no-journeys{display:flex;align-items:flex-start;gap:9px;margin-top:15px;padding:11px 12px;background:#f4f6f2;border:1px solid #dce5e0;border-radius:3px}
     .ft-no-journeys-dot{width:7px;height:7px;margin-top:3px;border-radius:50%;background:#d38b59;flex:none}
     .ft-no-journeys b,.ft-no-journeys small{display:block}
     .ft-no-journeys b{color:#576f70;font-size:8px}.ft-no-journeys small{margin-top:3px;color:#8a9996;font-size:7px;line-height:1.6}
     .ft-campaign-bottom{display:flex;justify-content:space-between;margin-top:39px;padding-top:14px;border-top:1px solid #d5dfdd;color:#9ba9a8;font:7px 'DM Mono',monospace;letter-spacing:.1em}
     .ft-sender-section{padding:108px 0 70px;background:#f6f7f4}
     .ft-sender-layout{display:grid;grid-template-columns:.88fr 1.12fr;gap:10%;align-items:center}
     .ft-sender-heading h2{font-size:clamp(40px,4.4vw,55px)}
     .ft-sender-heading>p{max-width:420px}
     .ft-underlined-cta{display:inline-flex;align-items:center;gap:8px;margin-top:22px;padding-bottom:7px;border-bottom:1px solid #a6b7b8;color:#314d60;font-size:10px;font-weight:700}
     .ft-sender-panel{padding:20px 21px 0;border:1px solid #dce5e2;border-radius:5px;background:#fbfcf9;box-shadow:0 16px 35px rgba(37,58,69,.07);transform:rotate(.6deg)}
     .ft-sender-panel-head{display:flex;justify-content:space-between;align-items:center;padding-bottom:15px;border-bottom:1px solid #e8eeeb;color:#81918f;font:7px 'DM Mono',monospace;letter-spacing:.08em}
     .ft-sender-panel-head>span:first-child{display:flex;align-items:center;gap:7px;color:#526f72}
     .ft-sender-panel-head svg{color:#628b72}
     .ft-sender-status{display:flex;align-items:center;gap:5px;color:#5a856b}
     .ft-sender-status i,.ft-sender-fields span{width:5px;height:5px;border-radius:50%;background:#72a280}
     .ft-sender-identity{display:flex;align-items:center;gap:11px;padding:17px 1px}
     .ft-sender-avatar{display:grid;place-items:center;width:35px;height:35px;border-radius:50%;background:#e9f0eb;color:#5a806e}
     .ft-sender-identity>span{display:flex;flex:1;min-width:0;flex-direction:column;gap:4px}
     .ft-sender-identity small,.ft-sender-fields small{color:#9aa6a4;font:6px 'DM Mono',monospace;letter-spacing:.1em}
     .ft-sender-identity b{color:#3b5360;font-size:9px}.ft-sender-identity em{color:#94a09f;font-size:7px;font-style:normal}
     .ft-sender-identity>svg{color:#679277}
     .ft-sender-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px 0;border-top:1px solid #edf0ee;border-bottom:1px solid #edf0ee}
     .ft-sender-fields>div{display:flex;flex-direction:column;gap:7px}
     .ft-sender-fields b{display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#5e737c;font:7px 'DM Mono',monospace}
     .ft-sender-buttons{display:flex;justify-content:flex-end;gap:8px;padding:12px 0}
     .ft-sender-buttons span{display:flex;align-items:center;gap:5px;padding:8px 9px;border:1px solid #d5e0dd;border-radius:3px;color:#618078;font-size:7px}
     .ft-sender-buttons span:last-child{border-color:#2865ae;background:#2865ae;color:white}
     .ft-sender-multi{display:flex;align-items:flex-start;gap:9px;margin:0 -21px;padding:13px 21px;background:#f1f4f0;border-radius:0 0 5px 5px}
     .ft-multi-icon{display:grid;place-items:center;width:25px;height:25px;flex:none;border-radius:50%;background:#e3ece6;color:#57806b}
     .ft-sender-multi b,.ft-sender-multi small{display:block}
     .ft-sender-multi b{color:#4b6665;font-size:8px}.ft-sender-multi small{max-width:380px;margin-top:4px;color:#859591;font-size:7px;line-height:1.7}
     .ft-sending-boundary{display:flex;align-items:flex-start;gap:12px;margin-top:42px;padding:18px 20px;border:1px solid #dfe7e3;background:#eef2ed;color:#70847b}
     .ft-boundary-icon{display:grid;place-items:center;width:28px;height:28px;flex:none;border-radius:50%;background:#e1ebe3;color:#5a8069}
     .ft-sending-boundary p{margin:0;color:#73827e;font-size:9px;line-height:1.85}
     .ft-sending-boundary b{color:#455f58}
     .ft-history-section{padding:96px 0 104px;background:#eaf0f0}
     .ft-history-layout{display:grid;grid-template-columns:.8fr 1.2fr;gap:9%;align-items:center}
     .ft-history-layout h2{font-size:clamp(39px,4.5vw,54px)}
     .ft-history-layout>div:first-child>p{max-width:380px}
     .ft-honesty{display:flex;align-items:flex-start;gap:9px;max-width:340px;margin-top:20px;padding:11px 12px;border-left:2px solid #d2875b;background:#f1f4f1}
     .ft-honesty>span{color:#5e866f}.ft-honesty p{margin:0;color:#71817f;font-size:8px;line-height:1.7}
     .ft-history-card{padding:19px 20px 0;border:1px solid #d5dfdf;border-radius:5px;background:#f9faf7;box-shadow:0 15px 32px rgba(36,58,72,.08);transform:rotate(-.55deg)}
     .ft-history-card-head{display:flex;justify-content:space-between;padding-bottom:13px;border-bottom:1px solid #e7edeb;color:#879695;font:7px 'DM Mono',monospace;letter-spacing:.09em}
     .ft-history-card-head span:last-child{display:flex;align-items:center;gap:5px;color:#73898d}
     .ft-history-campaign{display:flex;align-items:center;gap:9px;padding:15px 0}
     .ft-history-campaign-icon{display:grid;place-items:center;width:29px;height:29px;border-radius:5px;background:#e8eef2;color:#557c99}
     .ft-history-campaign>span:nth-child(2){display:flex;flex:1;min-width:0;flex-direction:column;gap:4px}
     .ft-history-campaign b{color:#3c5361;font-size:8px}.ft-history-campaign small{overflow:hidden;color:#98a4a2;font-size:7px;text-overflow:ellipsis;white-space:nowrap}
     .ft-history-done{padding:5px 6px;border-radius:2px;background:#e9f1eb;color:#63836b;font:6px 'DM Mono',monospace}
     .ft-history-divider{height:1px;background:#e7edeb}
     .ft-outcome-row{display:grid;grid-template-columns:23px 1fr auto;gap:9px;align-items:center;padding:13px 2px;border-bottom:1px solid #edf0ee}
     .ft-outcome-check,.ft-outcome-symbol{display:grid;place-items:center;width:21px;height:21px;border-radius:50%;background:#eaf1eb;color:#5d8869}
     .ft-outcome-symbol{background:#f0f1ee;color:#a1aaa5;font:10px 'DM Mono',monospace}
     .ft-outcome-row>span:nth-child(2) b,.ft-outcome-row>span:nth-child(2) small{display:block}
     .ft-outcome-row>span:nth-child(2) b{color:#536c6a;font-size:8px}.ft-outcome-row>span:nth-child(2) small{margin-top:4px;color:#9aa5a2;font-size:7px}
     .ft-outcome-row time,.ft-not-reported{color:#96a19f;font:7px 'DM Mono',monospace}
     .ft-outcome-muted .ft-outcome-check{background:#eff0ed}
     .ft-history-card-bottom{display:flex;justify-content:space-between;padding:13px 0;color:#9ca9a6;font:6px 'DM Mono',monospace;letter-spacing:.07em}
     .ft-history-card-bottom span:last-child{display:flex;align-items:center;gap:4px;color:#658196}
     .ft-faq-section{padding:83px 0 97px;background:#f6f7f4}
     .ft-faq-layout{display:grid;grid-template-columns:.75fr 1.25fr;gap:10%}
     .ft-faq-layout h2{margin:19px 0 0;color:#192b40;font-size:clamp(34px,3.7vw,45px);letter-spacing:-.065em;line-height:1.08}
     .ft-faq-layout .faq-items{border-color:#dce3e1}
     .ft-faq-layout .faq-items details{border-color:#dce3e1}
     .ft-faq-layout .faq-items summary{min-height:58px;color:#2b4252;font-size:10px}
     .ft-faq-layout .faq-items details p{font-size:9px}
     .ft-final-cta{position:relative;min-height:410px;display:flex;align-items:center;overflow:hidden;padding:72px max(calc((100% - 1150px)/2),32px);background:#17263e;color:#fff}
     .ft-final-inner{position:relative;z-index:2}
     .ft-final-inner .mf-eyebrow{color:#b0c2cb}
     .ft-final-inner h2{margin:19px 0 13px;color:#f4f6f1;font-size:clamp(43px,5vw,63px);letter-spacing:-.07em;line-height:1.04}
     .ft-final-inner h2 em{color:#9fb9c8}
     .ft-final-inner>p{margin:0 0 22px;color:#afbdc5;font-size:11px}
     .ft-final-inner>div{display:flex;align-items:center;gap:23px}
     .ft-final-inner .mf-button-light{min-height:46px}
     .ft-final-pricing{display:flex;align-items:center;gap:6px;color:#d0dbe0;font-size:10px}
     .ft-final-foot{display:block;margin-top:17px;color:#8497a3;font:7px 'DM Mono',monospace;letter-spacing:.1em}
     .ft-final-index{position:absolute;right:8%;bottom:30px;color:#90a1ad;font:7px 'DM Mono',monospace;letter-spacing:.12em}
     .ft-final-orbit{position:absolute;right:5%;top:50%;width:min(440px,42vw);aspect-ratio:1;border:1px solid rgba(166,189,200,.21);border-radius:50%;transform:translateY(-50%)}
     .ft-final-orbit:before,.ft-final-orbit:after{content:"";position:absolute;inset:30px;border:1px solid rgba(166,189,200,.16);border-radius:50%}
     .ft-final-orbit:after{inset:76px}
     .ft-final-orbit i{position:absolute;left:14%;top:47%;width:9px;height:9px;border:1px solid #7591a0;border-radius:50%;background:#213953}
     .ft-final-orbit i:nth-child(2){left:66%;top:14%;background:#e34c55;border-color:#e34c55}
     .ft-final-orbit i:nth-child(3){left:78%;top:73%}
     @keyframes ft-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
     @media(max-width:900px){.ft-hero-wrap{grid-template-columns:1fr 1fr;gap:20px}.ft-hero h1{font-size:clamp(46px,6.7vw,65px)}.ft-hero-art{padding-left:14px;min-height:420px}.ft-audience-layout{gap:5%}.ft-campaign-layout{gap:5%}.ft-sender-layout{gap:5%}.ft-history-layout{gap:5%}}
     @media(max-width:640px){
       .ft-hero{padding-top:44px}.ft-hero-wrap{width:calc(100% - 38px);display:flex;flex-direction:column;align-items:stretch;gap:4px}
       .ft-hero-copy{padding:0}.ft-hero-index{margin-top:25px;font-size:8px}.ft-hero h1{font-size:clamp(45px,13vw,63px);margin:14px 0 16px}
       .ft-hero-lede{font-size:12px;line-height:1.8}.ft-hero-copy .mf-hero-actions{gap:16px;margin-top:20px}.ft-hero-copy .mf-button{min-height:45px;padding:0 14px;font-size:10px}.ft-hero-copy .mf-text-link{font-size:10px}
       .ft-hero-note{font-size:9px;margin-top:15px}.ft-hero-art{min-height:350px;margin:17px 0 0;padding:19px 8px 17px 13px}.ft-hero-art:before{inset:0 0 4px}.ft-art-label{font-size:6px}
       .ft-route-stage{margin:21px 0 0 5px;padding:14px 12px 13px}.ft-route-card{min-height:61px;padding:8px;gap:8px}.ft-route-icon{width:30px;height:30px}.ft-route-card b{font-size:8px}.ft-route-card em{font-size:7px}.ft-route-card small{font-size:6px}.ft-connected{font-size:6px}.ft-route-connector{height:20px}
       .ft-hero-callout{margin:13px 0 0 8px;font-size:7px}.ft-art-caption{font-size:6px;margin-top:14px}.ft-hero-bottom{width:calc(100% - 38px);height:47px;font-size:6px}.ft-hero-bottom a{font-size:8px}
       .ft-thesis{padding:23px 0}.ft-thesis-inner{grid-template-columns:1fr;gap:9px}.ft-thesis-kicker{font-size:7px}.ft-thesis-inner p{font-size:17px}.ft-thesis-end{display:none}
       .ft-audience-section{padding:69px 0 74px}.ft-audience-layout{grid-template-columns:1fr;gap:27px}.ft-section-copy h2,.ft-campaign-intro h2,.ft-sender-heading h2,.ft-history-layout h2{font-size:40px;margin:17px 0 14px}.ft-section-copy>p,.ft-sender-heading>p,.ft-history-layout>div:first-child>p{font-size:11px}.ft-check-list{font-size:9px;gap:10px;margin:18px 0}.ft-field-chip{font-size:6px}
       .ft-preview-stage{padding:17px 0 12px 9px}.ft-preview-label{font-size:6px;padding:0 8px 8px}.ft-audience-window{padding:9px 8px 0}.ft-person-row{gap:4px;min-height:44px;grid-template-columns:1.36fr .83fr .68fr}.ft-person-row>span:nth-child(2) b{font-size:6px}.ft-person-row>span:nth-child(2) small{font-size:5px}.ft-person-row>span:nth-child(3){font-size:6px}.ft-person-row em{font-size:5px;padding:3px 4px}.ft-table-head{font-size:5px;gap:4px}.ft-history-note{width:89%;padding:8px 9px}.ft-history-note small{font-size:6px}
       .ft-campaign-section{padding:68px 0 28px}.ft-campaign-intro{display:block;margin-bottom:25px}.ft-campaign-intro>p{margin-top:14px;font-size:10px}.ft-campaign-layout{grid-template-columns:1fr;gap:27px}.ft-campaign-window{padding:15px 13px 12px}.ft-campaign-steps article{padding:13px 0}.ft-campaign-steps h3{font-size:11px}.ft-campaign-steps p{font-size:8px}.ft-campaign-bottom{margin-top:28px;font-size:6px}
       .ft-sender-section{padding:70px 0 50px}.ft-sender-layout{grid-template-columns:1fr;gap:25px}.ft-sender-heading h2{font-size:40px}.ft-sender-panel{padding:16px 13px 0}.ft-sender-panel-head{font-size:6px}.ft-sender-identity{gap:8px;padding:13px 0}.ft-sender-identity b{font-size:8px}.ft-sender-fields b{font-size:6px}.ft-sender-buttons span{font-size:6px;padding:7px}.ft-sender-multi{margin:0 -13px;padding:11px 13px}.ft-sending-boundary{margin-top:24px;padding:13px;gap:8px}.ft-sending-boundary p{font-size:8px}
       .ft-history-section{padding:67px 0 73px}.ft-history-layout{grid-template-columns:1fr;gap:26px}.ft-history-card{padding:15px 12px 0}.ft-history-campaign small{font-size:6px}.ft-history-done{font-size:5px}.ft-outcome-row>span:nth-child(2) b{font-size:7px}.ft-outcome-row>span:nth-child(2) small{font-size:6px}.ft-history-card-bottom{font-size:5px}
       .ft-faq-section{padding:65px 0 73px}.ft-faq-layout{grid-template-columns:1fr;gap:22px}.ft-faq-layout h2{font-size:35px}.ft-faq-layout .faq-items summary{font-size:9px;min-height:52px}.ft-faq-layout .faq-items details p{font-size:8px}
       .ft-final-cta{min-height:370px;padding:58px 20px}.ft-final-inner h2{font-size:43px}.ft-final-inner>p{font-size:10px;line-height:1.7;max-width:290px}.ft-final-inner>div{gap:15px}.ft-final-inner .mf-button-light{min-height:43px;padding:0 13px;font-size:10px}.ft-final-pricing{font-size:9px}.ft-final-orbit{width:78vw;right:-45%;opacity:.72}.ft-final-index{right:5%;bottom:16px;font-size:6px}
     }
    @media(prefers-reduced-motion:reduce){.mf-site *, .mf-site *:before,.mf-site *:after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
  `}</style>;
}
