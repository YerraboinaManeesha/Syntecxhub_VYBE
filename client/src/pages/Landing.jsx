import { Link } from 'react-router-dom';
import {
  ArrowRight,
  MessageCircle,
  ShieldCheck,
  Users,
  Zap,
  Image,
  CircleDot,
  Heart,
  Sparkles,
  LockKeyhole,
  ArrowUpRight,
  Check
} from 'lucide-react';
import VYBELogo from '../components/layout/VYBELogo.jsx';
import '../styles/landing.css';

const FEATURES = [
  {
    icon: Zap,
    title: 'Conversations in real time',
    text: 'Messages arrive instantly. Stay connected without refreshing or missing a moment.',
    className: 'violet'
  },
  {
    icon: LockKeyhole,
    title: 'Your space, your privacy',
    text: 'Private conversations designed to keep your chats accessible only to authorized participants.',
    className: 'purple'
  },
  {
    icon: Users,
    title: 'Better together',
    text: 'Create group conversations, bring your people together, and share moments in one place.',
    className: 'lavender'
  },
  {
    icon: Image,
    title: 'Share more than words',
    text: 'Make conversations richer by sharing photos, videos, and other files.',
    className: 'violet'
  },
  {
    icon: CircleDot,
    title: 'There when you need them',
    text: 'See online presence and pick up your conversations whenever you return.',
    className: 'purple'
  },
  {
    icon: ShieldCheck,
    title: 'Simple and dependable',
    text: 'Enjoy account-based access and persistent chat history in one convenient place.',
    className: 'lavender'
  }
];

export default function Landing() {
  return (
    <div className="landing">
      <header className="lp-header">
        <div className="container lp-header-inner">
          <Link to="/" className="lp-brand" aria-label="VYBE home">
            <VYBELogo size={32} />
          </Link>

          <nav className="lp-nav" aria-label="Main navigation">
            <a href="#features">Features</a>
            <a href="#about">About </a>
          </nav>

          <div className="lp-header-actions">
            <Link to="/login" className="lp-signin">
              Sign In
            </Link>
            <Link to="/register" className="lp-header-cta">
              Get Started 
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-orb lp-orb-one" aria-hidden="true" />
          <div className="lp-orb lp-orb-two" aria-hidden="true" />

          <div className="container lp-hero-layout">
            <div className="lp-hero-copy">
              <div className="lp-pill">
                <span className="lp-pill-dot" />
                YOUR PEOPLE. YOUR SPACE.
              </div>

              <h1>
                A little closer,
                <br />
                <span>a lot more</span>
                <br />
                connected.
              </h1>

              <p className="lp-lead">
                The conversations that matter deserve a place of their own.
                Meet VYBE — your space to connect, share, and stay close.
              </p>

              <div className="lp-cta-row">
                <Link to="/register" className="lp-button lp-button-primary">
                  Get Started 
                </Link>
                <Link to="/login" className="lp-button lp-button-secondary">
                  Sign In
                </Link>
              </div>

              <p className="lp-trust-note">
                <span className="lp-trust-icon">
                  <Check size={14} />
                </span>
                Made for everyday conversations
              </p>
            </div>

            <div className="lp-hero-art" aria-label="Decorative VYBE artwork">
              <div className="lp-art-glow" />

              <div className="lp-glass-card lp-card-back">
                <div className="lp-card-mini-icon">
                  <Heart size={18} />
                </div>
                <span>Closer, even when apart.</span>
              </div>

              <div className="lp-hero-orbit lp-orbit-one" />
              <div className="lp-hero-orbit lp-orbit-two" />

              <div className="lp-hero-emblem">
                <div className="lp-emblem-ring">
                  <div className="lp-emblem-core">
                    <MessageCircle size={58} strokeWidth={1.5} />
                    <span className="lp-emblem-spark">
                      <Sparkles size={22} />
                    </span>
                  </div>
                </div>
                <div className="lp-emblem-caption">
                  YOUR WORLD, IN ONE PLACE
                </div>
              </div>

              <div className="lp-glass-card lp-card-front">
                <div className="lp-floating-icon">
                  <Users size={19} />
                </div>
                <div>
                  <strong>Good people.</strong>
                  <p>Great conversations.</p>
                </div>
                <span className="lp-card-heart">
                  <Heart size={17} fill="currentColor" />
                </span>
              </div>

              <div className="lp-deco lp-deco-one" aria-hidden="true">✳</div>
              <div className="lp-deco lp-deco-two" aria-hidden="true">✦</div>
              <div className="lp-deco lp-deco-three" aria-hidden="true">·</div>
            </div>
          </div>

          <div className="container lp-hero-bottom">
            <span>ONE-TO-ONE CHATS</span>
            <span className="lp-bottom-separator" />
            <span>YOUR GROUPS</span>
            <span className="lp-bottom-separator" />
            <span>YOUR MOMENTS</span>
          </div>
        </section>

        <section id="features" className="lp-section">
          <div className="container">
            <div className="lp-section-heading">
              <span className="lp-section-eyebrow">THE VYBE EXPERIENCE</span>
              <h2>
                Everything you need.
                <br />
                <span>Nothing getting in the way.</span>
              </h2>
              <p>
                Less complication. More connection. All the essentials
                for conversations that feel effortless.
              </p>
            </div>

            <div className="lp-features">
              {FEATURES.map(({ icon: Icon, title, text, className }, index) => (
                <article className="lp-feature" key={title}>
                  <div className={`lp-feature-icon ${className}`}>
                    <Icon size={22} strokeWidth={1.8} />
                  </div>
                  <span className="lp-feature-number">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  <div className="lp-feature-line" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="about" className="lp-about">
          <div className="container lp-about-inner">
            <div className="lp-about-art" aria-hidden="true">
              <div className="lp-about-circle lp-about-circle-one" />
              <div className="lp-about-circle lp-about-circle-two" />
              <div className="lp-about-glass">
                <MessageCircle size={36} />
                <Heart size={22} className="lp-about-heart" />
              </div>
            </div>

            <div className="lp-about-copy">
              <span className="lp-section-eyebrow">
                A SPACE THAT FEELS LIKE YOURS
              </span>
              <h2>
                It's not just
                <br />
                a message.
                <br />
                <span>It's a connection.</span>
              </h2>
              <p>
                VYBE brings your conversations into one simple space.
                Catch up one-to-one, bring everyone into a group, and
                keep the moments that matter within reach.
              </p>
              <Link to="/register" className="lp-text-link">
                Find your VYBE <ArrowRight size={17} />
              </Link>
            </div>
          </div>
        </section>

        <section className="lp-final">
          <div className="container lp-final-inner">
            <div className="lp-final-spark">
              <Sparkles size={24} />
            </div>
            <span className="lp-section-eyebrow">
              YOUR NEXT CHAPTER STARTS HERE
            </span>
            <h2>
              Your people are here.
              <br />
              <span>Come find your VYBE.</span>
            </h2>
            <p>
              Make room for the conversations you'll want to come back to.
            </p>
            <Link to="/register" className="lp-button lp-button-primary">
              Join VYBE 
            </Link>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="container lp-footer-inner">
          <div className="lp-footer-brand">
            <VYBELogo size={26} />
            <p>Real-time messaging for the people who matter.</p>
          </div>
          <nav className="lp-footer-nav" aria-label="Footer">
            <a href="#features">Features</a>
            <a href="#about">About</a>
            <Link to="/login">Sign In</Link>
            <Link to="/register">Get Started</Link>
          </nav>
        </div>
        <div className="container lp-copyright">&copy; {new Date().getFullYear()} VYBE. All rights reserved.</div>
      </footer>
    </div>
  );
}