'use client';

import { useState, useEffect } from 'react';
import {
  Brain, Shield, Network, Sparkles,
  ChevronRight, Lock, Eye, Zap,
  Database, GitBranch, Layers, Activity
} from 'lucide-react';

interface LandingPageProps {
  onEnter?: () => void;
}

export function LandingPage(_props: LandingPageProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-lattice-void overflow-hidden">
      {/* Animated background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-neon-blue/5 via-transparent to-neon-purple/5" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-neon-cyan/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-neon-purple/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-8 py-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-neon-cyan to-neon-blue flex items-center justify-center">
            <Brain className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-bold text-white">Concordos</span>
        </div>
        <nav className="hidden md:flex items-center gap-6">
          <a href="#features" className="text-gray-400 hover:text-white transition-colors">Features</a>
          <a href="#sovereignty" className="text-gray-400 hover:text-white transition-colors">Sovereignty</a>
          <a href="#architecture" className="text-gray-400 hover:text-white transition-colors">Architecture</a>
          <a
            href="/login"
            className="px-4 py-2 text-gray-300 hover:text-white transition-colors font-medium"
          >
            Sign In
          </a>
          <a
            href="/register"
            className="px-4 py-2 bg-neon-blue/20 border border-neon-blue/50 rounded-lg text-neon-blue hover:bg-neon-blue/30 transition-all"
          >
            Get Started
          </a>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 px-8 pt-20 pb-32 max-w-6xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-neon-purple/20 border border-neon-purple/30 rounded-full text-sm text-neon-purple mb-8">
          <Lock className="w-4 h-4" />
          <span>70% Sovereignty Lock - Your Mind, Your Rules</span>
        </div>

        <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
          <span className="text-white">Your Personal</span>
          <br />
          <span className="bg-gradient-to-r from-neon-cyan via-neon-blue to-neon-purple bg-clip-text text-transparent">
            Cognitive Engine
          </span>
        </h1>

        <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-8">
          A sovereign knowledge operating system that grows with you.
          Your thoughts never leave your control.
        </p>

        {/* Trust Signal — above the fold, before CTA */}
        <div className="flex flex-col items-center gap-1.5 mb-10">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm font-semibold">
            <span className="px-4 py-2 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan text-center">No ads. Ever.</span>
            <span className="px-4 py-2 rounded-lg bg-neon-blue/10 border border-neon-blue/20 text-neon-blue text-center">No subscriptions.</span>
            <span className="px-4 py-2 rounded-lg bg-neon-purple/10 border border-neon-purple/20 text-neon-purple text-center">No data extraction.</span>
            <span className="px-4 py-2 rounded-lg bg-neon-green/10 border border-neon-green/20 text-neon-green text-center">Free for all services.</span>
          </div>
          <p className="text-xs text-gray-400 mt-2">Not a promise — it&apos;s architecture. The sovereignty lock makes it mathematically enforced.</p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="/register"
            className="group px-8 py-4 bg-gradient-to-r from-neon-cyan to-neon-blue rounded-xl text-white font-semibold text-lg hover:shadow-lg hover:shadow-neon-cyan/25 transition-all flex items-center gap-2"
          >
            Get Started
            <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </a>
          <a
            href="#features"
            className="px-8 py-4 border border-gray-700 rounded-xl text-gray-300 font-semibold text-lg hover:border-gray-500 hover:text-white transition-all"
          >
            Learn More
          </a>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-20">
          <Stat value="175" label="Domain Lenses" />
          <Stat value="110+" label="Neural Organs" />
          <Stat value="70%" label="Sovereignty Lock" />
          <Stat value="100%" label="Local Control" />
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="relative z-10 px-8 py-24 bg-lattice-deep/50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4 text-white">
            A Complete Cognitive Architecture
          </h2>
          <p className="text-gray-400 text-center max-w-2xl mx-auto mb-16">
            Concordos combines knowledge management, AI reasoning, and personal sovereignty
            into one unified system.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon={<Database className="w-6 h-6" />}
              title="DTU-Based Memory"
              description="Every piece of knowledge is a DTU - atomic, linkable, and evolvable. Watch ideas compound into Mega and Hyper nodes."
              color="cyan"
            />
            <FeatureCard
              icon={<Network className="w-6 h-6" />}
              title="175 Domain Lenses"
              description="View your knowledge through different perspectives: healthcare, education, legal, trades, creative arts, science, AI, finance, and 160+ more specialized lenses."
              color="blue"
            />
            <FeatureCard
              icon={<Brain className="w-6 h-6" />}
              title="Local AI Integration"
              description="Connect to Ollama/Llama for private AI assistance. Your conversations stay on your machine."
              color="purple"
            />
            <FeatureCard
              icon={<Activity className="w-6 h-6" />}
              title="Resonance Tracking"
              description="Ideas that matter surface automatically. The system learns what resonates with you."
              color="pink"
            />
            <FeatureCard
              icon={<GitBranch className="w-6 h-6" />}
              title="Federation Ready"
              description="Share knowledge across instances with consent-based federation. Connect without compromising."
              color="green"
            />
            <FeatureCard
              icon={<Layers className="w-6 h-6" />}
              title="Sovereign by Design"
              description="70% sovereignty lock with immutable ethical invariants. No telemetry, no ads, no secret monitoring. You own every byte."
              color="orange"
            />
          </div>
        </div>
      </section>

      {/* Sovereignty Section */}
      <section id="sovereignty" className="relative z-10 px-8 py-24">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-sovereignty-locked/20 border border-sovereignty-locked/30 rounded-full text-sm text-sovereignty-locked mb-6">
                <Shield className="w-4 h-4" />
                <span>Immutable Guarantees</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold mb-6 text-white">
                The 70% Sovereignty Lock
              </h2>
              <p className="text-gray-400 mb-8">
                Core ethical invariants are hard-coded and immutable. Not even the system
                can modify these protections. Your data sovereignty is not a feature -
                it&apos;s a constitutional guarantee.
              </p>

              <div className="space-y-4">
                <LockItem icon={<Eye className="w-5 h-5" />} label="NO_TELEMETRY" description="Zero data leaves without explicit consent" />
                <LockItem icon={<Shield className="w-5 h-5" />} label="NO_ADS" description="No advertising, ever. Period." />
                <LockItem icon={<Lock className="w-5 h-5" />} label="NO_EXTRACTION" description="Your thoughts can't be used for training" />
                <LockItem icon={<Zap className="w-5 h-5" />} label="NO_NEGATIVE_VALENCE" description="System only creates constructive DTUs" />
              </div>
            </div>

            <div className="relative">
              <div className="bg-lattice-surface border border-lattice-border rounded-2xl p-8">
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-sovereignty-locked/20 border-2 border-sovereignty-locked mb-4">
                    <Lock className="w-10 h-10 text-sovereignty-locked" />
                  </div>
                  <h3 className="text-2xl font-bold text-white">Sovereignty Status</h3>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 bg-lattice-deep rounded-lg">
                    <span className="text-gray-400">Core Lock</span>
                    <span className="text-sovereignty-locked font-mono">70% IMMUTABLE</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-lattice-deep rounded-lg">
                    <span className="text-gray-400">Data Location</span>
                    <span className="text-sovereignty-locked font-mono">LOCAL ONLY</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-lattice-deep rounded-lg">
                    <span className="text-gray-400">External Calls</span>
                    <span className="text-sovereignty-locked font-mono">OPT-IN ONLY</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-lattice-deep rounded-lg">
                    <span className="text-gray-400">Chicken2 Guard</span>
                    <span className="text-sovereignty-locked font-mono">ACTIVE</span>
                  </div>
                </div>
              </div>

              {/* Decorative glow */}
              <div className="absolute -inset-4 bg-sovereignty-locked/10 rounded-3xl blur-2xl -z-10" />
            </div>
          </div>
        </div>
      </section>

      {/* Architecture Section */}
      <section id="architecture" className="relative z-10 px-8 py-24 bg-lattice-deep/50">
        <div className="max-w-6xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-white">
            Cognitive Architecture
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto mb-16">
            110+ neural organs working in harmony. Goal systems, world models,
            reasoning chains, metacognition, and more - all running locally.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <ArchItem label="Goal System" desc="Constructive objectives" />
            <ArchItem label="World Model" desc="Entity relationships" />
            <ArchItem label="Semantic Engine" desc="Local embeddings" />
            <ArchItem label="Transfer Learning" desc="Cross-domain patterns" />
            <ArchItem label="Commonsense" desc="Foundational knowledge" />
            <ArchItem label="Grounding" desc="Real-world actions" />
            <ArchItem label="Reasoning Chains" desc="Traceable logic" />
            <ArchItem label="Hypothesis Engine" desc="Scientific method" />
            <ArchItem label="Metacognition" desc="Self-assessment" />
            <ArchItem label="Explanation" desc="Why it thinks" />
            <ArchItem label="Meta-Learning" desc="Strategy adaptation" />
            <ArchItem label="Governor" desc="Safety heartbeat" />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative z-10 px-8 py-24">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6 text-white">
            Ready to Own Your Mind?
          </h2>
          <p className="text-gray-400 text-lg mb-8">
            Start building your sovereign knowledge empire today.
            No data collected. Just pure cognitive power.
          </p>
          <a
            href="/register"
            className="group px-10 py-5 bg-gradient-to-r from-neon-cyan to-neon-blue rounded-xl text-white font-semibold text-xl hover:shadow-xl hover:shadow-neon-cyan/30 transition-all inline-flex items-center gap-3 mx-auto"
          >
            <Sparkles className="w-6 h-6" />
            Create Your Account
            <ChevronRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 px-8 py-8 border-t border-lattice-border">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-neon-cyan to-neon-blue flex items-center justify-center">
              <Brain className="w-4 h-4 text-white" />
            </div>
            <span className="text-gray-400">Concordos Cognitive Engine</span>
          </div>
          <p className="text-gray-400 text-sm">
            Sovereign by design. Open by philosophy. Yours forever.
          </p>
        </div>
      </footer>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-4xl font-bold bg-gradient-to-r from-neon-cyan to-neon-blue bg-clip-text text-transparent">
        {value}
      </div>
      <div className="text-gray-400 text-sm mt-1">{label}</div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  color
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: 'cyan' | 'blue' | 'purple' | 'pink' | 'green' | 'orange';
}) {
  const colorClasses = {
    cyan: 'border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan',
    blue: 'border-neon-blue/30 bg-neon-blue/10 text-neon-blue',
    purple: 'border-neon-purple/30 bg-neon-purple/10 text-neon-purple',
    pink: 'border-neon-pink/30 bg-neon-pink/10 text-neon-pink',
    green: 'border-neon-green/30 bg-neon-green/10 text-neon-green',
    orange: 'border-neon-orange/30 bg-neon-orange/10 text-neon-orange',
  };

  return (
    <div className="p-6 bg-lattice-surface border border-lattice-border rounded-xl hover:border-gray-600 transition-colors group">
      <div className={`inline-flex items-center justify-center w-12 h-12 rounded-lg border ${colorClasses[color]} mb-4`}>
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-neon-cyan transition-colors">
        {title}
      </h3>
      <p className="text-gray-400 text-sm leading-relaxed">
        {description}
      </p>
    </div>
  );
}

function LockItem({ icon, label, description }: { icon: React.ReactNode; label: string; description: string }) {
  return (
    <div className="flex items-start gap-4 p-4 bg-lattice-surface border border-lattice-border rounded-lg">
      <div className="text-sovereignty-locked mt-0.5">{icon}</div>
      <div>
        <div className="font-mono text-sovereignty-locked font-semibold">{label}</div>
        <div className="text-gray-400 text-sm">{description}</div>
      </div>
    </div>
  );
}

function ArchItem({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="p-4 bg-lattice-surface border border-lattice-border rounded-lg hover:border-neon-cyan/50 transition-colors">
      <div className="font-semibold text-white text-sm">{label}</div>
      <div className="text-gray-400 text-xs mt-1">{desc}</div>
    </div>
  );
}
