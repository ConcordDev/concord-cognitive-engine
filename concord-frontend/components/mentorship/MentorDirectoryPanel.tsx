'use client';

/**
 * MentorDirectoryPanel — ADPList-shape mentor marketplace: register a mentor
 * profile, browse/search the directory, open a profile with reviews, send a
 * connection request, and leave a review. All data comes from the
 * `mentorship` domain macros — no seed/mock values.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Plus, Search, Star, Users, Send, ChevronLeft, BadgeCheck, X,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Mentor {
  id: string;
  name: string;
  headline: string;
  bio: string;
  skills: string[];
  experienceYears: number;
  availability: string;
  capacity: number;
  hourlyFocus: string;
  rating: number;
  reviewCount: number;
  menteeCount: number;
  listed: boolean;
}
interface Review {
  id: string; authorName: string; rating: number; comment: string;
  tags: string[]; createdAt: string;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn('w-3.5 h-3.5', n <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-zinc-700')} />
      ))}
    </span>
  );
}

const SORTS = [
  { key: 'rating', label: 'Top rated' },
  { key: 'experience', label: 'Most experienced' },
  { key: 'availability', label: 'Most available' },
];

export function MentorDirectoryPanel() {
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [allSkills, setAllSkills] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [skillFilter, setSkillFilter] = useState('');
  const [sort, setSort] = useState('rating');

  const [showRegister, setShowRegister] = useState(false);
  const [regForm, setRegForm] = useState({
    name: '', headline: '', bio: '', skills: '', experienceYears: '3',
    availability: 'weekly', capacity: '3', hourlyFocus: 'career',
  });
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState<Mentor | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [openSlots, setOpenSlots] = useState(0);

  const [reqForm, setReqForm] = useState({ menteeName: '', topic: '', message: '', goals: '' });
  const [revForm, setRevForm] = useState({ authorName: '', rating: 5, comment: '', tags: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('mentorship', 'mentor-directory', { query, skill: skillFilter, sort });
    if (r.data?.ok === false) { setError(r.data.error || 'Failed to load directory.'); }
    else {
      setMentors(r.data?.result?.mentors || []);
      setAllSkills(r.data?.result?.skills || []);
      setError(null);
    }
    setLoading(false);
  }, [query, skillFilter, sort]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openProfile = async (m: Mentor) => {
    setSelected(m);
    setReviews([]);
    setOpenSlots(0);
    const r = await lensRun('mentorship', 'mentor-profile', { mentorId: m.id });
    if (r.data?.ok !== false) {
      setSelected((r.data?.result?.mentor as Mentor) || m);
      setReviews(r.data?.result?.reviews || []);
      setOpenSlots(r.data?.result?.openSlots || 0);
    }
  };

  const register = async () => {
    if (!regForm.name.trim()) { setError('Mentor name is required.'); return; }
    setBusy(true);
    const r = await lensRun('mentorship', 'mentor-register', {
      name: regForm.name,
      headline: regForm.headline,
      bio: regForm.bio,
      skills: regForm.skills.split(',').map((s) => s.trim()).filter(Boolean),
      experienceYears: Number(regForm.experienceYears) || 0,
      availability: regForm.availability,
      capacity: Number(regForm.capacity) || 1,
      hourlyFocus: regForm.hourlyFocus,
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data.error || 'Registration failed.'); return; }
    setShowRegister(false);
    setRegForm({ name: '', headline: '', bio: '', skills: '', experienceYears: '3', availability: 'weekly', capacity: '3', hourlyFocus: 'career' });
    void refresh();
  };

  const sendRequest = async () => {
    if (!selected) return;
    setBusy(true);
    const r = await lensRun('mentorship', 'request-send', {
      mentorId: selected.id,
      menteeName: reqForm.menteeName || 'Mentee',
      topic: reqForm.topic,
      message: reqForm.message,
      goals: reqForm.goals.split(',').map((s) => s.trim()).filter(Boolean),
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data.error || 'Request failed.'); return; }
    setReqForm({ menteeName: '', topic: '', message: '', goals: '' });
    setError(null);
    alert('Connection request sent. Track it in the Requests tab.');
  };

  const addReview = async () => {
    if (!selected) return;
    setBusy(true);
    const r = await lensRun('mentorship', 'review-add', {
      mentorId: selected.id,
      authorName: revForm.authorName || 'Mentee',
      rating: revForm.rating,
      comment: revForm.comment,
      tags: revForm.tags.split(',').map((s) => s.trim()).filter(Boolean),
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data.error || 'Review failed.'); return; }
    setRevForm({ authorName: '', rating: 5, comment: '', tags: '' });
    void openProfile(selected);
    void refresh();
  };

  if (selected) {
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-sm text-zinc-400 hover:text-white">
          <ChevronLeft className="w-4 h-4" /> Back to directory
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="panel p-4 space-y-2">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <BadgeCheck className="w-5 h-5 text-neon-cyan" /> {selected.name}
              </h3>
              <p className="text-sm text-zinc-400">{selected.headline || 'Mentor'}</p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1"><Stars rating={selected.rating} /></div>
              <p className="text-xs text-zinc-500">{selected.reviewCount} reviews</p>
            </div>
          </div>
          {selected.bio && <p className="text-sm text-zinc-300">{selected.bio}</p>}
          <div className="flex flex-wrap gap-1.5">
            {selected.skills.map((s) => (
              <span key={s} className="px-2 py-0.5 text-xs rounded-full bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20">{s}</span>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs text-zinc-400 pt-2">
            <span>Experience: <b className="text-white">{selected.experienceYears}y</b></span>
            <span>Availability: <b className="text-white">{selected.availability}</b></span>
            <span>Open slots: <b className={cn(openSlots > 0 ? 'text-neon-green' : 'text-red-400')}>{openSlots}/{selected.capacity}</b></span>
          </div>
        </div>

        {/* Send a request */}
        <div className="panel p-4 space-y-2">
          <h4 className="font-semibold text-sm flex items-center gap-2"><Send className="w-4 h-4 text-neon-blue" /> Request mentorship</h4>
          <div className="grid grid-cols-2 gap-2">
            <input value={reqForm.menteeName} onChange={(e) => setReqForm((p) => ({ ...p, menteeName: e.target.value }))} placeholder="Your name" className="input-lattice" />
            <input value={reqForm.topic} onChange={(e) => setReqForm((p) => ({ ...p, topic: e.target.value }))} placeholder="Topic" className="input-lattice" />
          </div>
          <input value={reqForm.goals} onChange={(e) => setReqForm((p) => ({ ...p, goals: e.target.value }))} placeholder="Goals (comma-separated)" className="input-lattice w-full" />
          <textarea value={reqForm.message} onChange={(e) => setReqForm((p) => ({ ...p, message: e.target.value }))} placeholder="Message to the mentor..." rows={2} className="input-lattice w-full" />
          <button onClick={sendRequest} disabled={busy} className="btn-neon w-full">
            {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Send request'}
          </button>
        </div>

        {/* Reviews */}
        <div className="panel p-4 space-y-3">
          <h4 className="font-semibold text-sm flex items-center gap-2"><Star className="w-4 h-4 text-amber-400" /> Reviews ({reviews.length})</h4>
          {reviews.length === 0 ? (
            <p className="text-xs text-zinc-500">No reviews yet. Be the first.</p>
          ) : reviews.map((rv) => (
            <div key={rv.id} className="lens-card text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{rv.authorName}</span>
                <Stars rating={rv.rating} />
              </div>
              {rv.comment && <p className="text-zinc-300 text-xs mt-1">{rv.comment}</p>}
              {rv.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {rv.tags.map((t) => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{t}</span>)}
                </div>
              )}
            </div>
          ))}
          <div className="border-t border-zinc-800 pt-2 space-y-2">
            <p className="text-xs text-zinc-400">Leave a review</p>
            <div className="flex items-center gap-2">
              <input value={revForm.authorName} onChange={(e) => setRevForm((p) => ({ ...p, authorName: e.target.value }))} placeholder="Your name" className="input-lattice flex-1" />
              <select value={revForm.rating} onChange={(e) => setRevForm((p) => ({ ...p, rating: Number(e.target.value) }))} className="input-lattice">
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}
              </select>
            </div>
            <input value={revForm.comment} onChange={(e) => setRevForm((p) => ({ ...p, comment: e.target.value }))} placeholder="Comment" className="input-lattice w-full" />
            <input value={revForm.tags} onChange={(e) => setRevForm((p) => ({ ...p, tags: e.target.value }))} placeholder="Tags (comma-separated)" className="input-lattice w-full" />
            <button onClick={addReview} disabled={busy} className="btn-secondary text-sm w-full">
              {busy ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Post review'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-neon-cyan" /> Mentor Directory</h3>
        <button onClick={() => setShowRegister(!showRegister)} className="btn-neon text-sm">
          {showRegister ? <X className="w-4 h-4 inline" /> : <Plus className="w-4 h-4 inline" />} {showRegister ? 'Cancel' : 'List as mentor'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {showRegister && (
        <div className="panel p-4 space-y-2">
          <h4 className="font-semibold text-sm">Become a mentor</h4>
          <div className="grid grid-cols-2 gap-2">
            <input value={regForm.name} onChange={(e) => setRegForm((p) => ({ ...p, name: e.target.value }))} placeholder="Display name *" className="input-lattice" />
            <input value={regForm.headline} onChange={(e) => setRegForm((p) => ({ ...p, headline: e.target.value }))} placeholder="Headline" className="input-lattice" />
          </div>
          <textarea value={regForm.bio} onChange={(e) => setRegForm((p) => ({ ...p, bio: e.target.value }))} placeholder="Short bio" rows={2} className="input-lattice w-full" />
          <input value={regForm.skills} onChange={(e) => setRegForm((p) => ({ ...p, skills: e.target.value }))} placeholder="Skills (comma-separated)" className="input-lattice w-full" />
          <div className="grid grid-cols-3 gap-2">
            <input type="number" value={regForm.experienceYears} onChange={(e) => setRegForm((p) => ({ ...p, experienceYears: e.target.value }))} placeholder="Years" className="input-lattice" />
            <select value={regForm.availability} onChange={(e) => setRegForm((p) => ({ ...p, availability: e.target.value }))} className="input-lattice">
              <option value="weekly">Weekly</option><option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option><option value="flexible">Flexible</option>
            </select>
            <input type="number" value={regForm.capacity} onChange={(e) => setRegForm((p) => ({ ...p, capacity: e.target.value }))} placeholder="Capacity" className="input-lattice" />
          </div>
          <button onClick={register} disabled={busy} className="btn-neon green w-full">
            {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Publish profile'}
          </button>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search mentors..." className="input-lattice w-full pl-9" />
        </div>
        <select value={skillFilter} onChange={(e) => setSkillFilter(e.target.value)} className="input-lattice">
          <option value="">All skills</option>
          {allSkills.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="input-lattice">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
      ) : mentors.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-8">No mentors found. List yourself as a mentor to seed the directory.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {mentors.map((m) => (
            <button key={m.id} onClick={() => openProfile(m)} className="lens-card text-left hover:border-neon-cyan transition-colors">
              <div className="flex items-center justify-between">
                <span className="font-semibold flex items-center gap-1.5">
                  <BadgeCheck className="w-4 h-4 text-neon-cyan" /> {m.name}
                </span>
                <Stars rating={m.rating} />
              </div>
              <p className="text-xs text-zinc-400 truncate">{m.headline || 'Mentor'}</p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {m.skills.slice(0, 4).map((s) => (
                  <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">{s}</span>
                ))}
              </div>
              <div className="flex items-center justify-between text-xs text-zinc-500 mt-1.5">
                <span>{m.experienceYears}y exp · {m.availability}</span>
                <span className={cn(m.menteeCount < m.capacity ? 'text-neon-green' : 'text-amber-400')}>
                  {Math.max(0, m.capacity - m.menteeCount)} slots
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
